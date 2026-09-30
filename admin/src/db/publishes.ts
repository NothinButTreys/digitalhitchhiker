import { conflict, notFound } from "../lib/errors";
import { isUniqueViolation } from "./errors";
import { buildSnapshot, sameSnapshot, summarize, type Snapshot } from "./snapshot";

export type Target = "preview" | "production";
export type PublishStatus = "queued" | "running" | "succeeded" | "failed";

export type PublishOut = {
  id: string;
  target: Target;
  status: PublishStatus;
  message: string;
  url: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export type PublishRow = {
  id: string;
  target: Target;
  status: PublishStatus;
  active: number | null;
  snapshot: string;
  message: string;
  url: string;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
};

export type PublishState = {
  latest: PublishOut | null;
  published: { finishedAt: string } | null;
  unpublishedChanges: boolean;
  problems: string[];
  summary: { categories: number; photographs: number };
};

/** A publish that has not reported for this long is given up on. */
export const STALE_AFTER_MS = 30 * 60 * 1000;

export function publishOut(row: PublishRow): PublishOut {
  return {
    id: row.id,
    target: row.target,
    status: row.status,
    message: row.message,
    url: row.url,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

export async function getPublishRow(db: D1Database, id: string): Promise<PublishRow | null> {
  return db.prepare("SELECT * FROM publishes WHERE id = ?").bind(id).first<PublishRow>();
}

export async function createPublish(db: D1Database, target: Target, snapshot: Snapshot, now: Date): Promise<PublishOut> {
  const id = crypto.randomUUID();
  const at = now.toISOString();
  try {
    await db
      .prepare(
        `INSERT INTO publishes (id, target, status, active, snapshot, started_at, updated_at)
         VALUES (?, ?, 'queued', 1, ?, ?, ?)`,
      )
      .bind(id, target, JSON.stringify(snapshot), at, at)
      .run();
  } catch (error) {
    // The UNIQUE column `active` is what enforces one publish at a time; two
    // presses arriving together cannot both get past it.
    if (isUniqueViolation(error, "publishes.active")) {
      throw conflict("publish_running", "A publish is already under way. Wait for it to finish.");
    }
    throw error;
  }
  return publishOut((await getPublishRow(db, id))!);
}

/**
 * Records a report from the workflow. One conditional statement, so a report
 * for a publish that has already finished (or been given up on) changes
 * nothing: a finished publish is never rewritten.
 */
export async function recordStatus(
  db: D1Database,
  id: string,
  update: { status: "running" | "succeeded" | "failed"; message: string; url: string },
  now: Date,
): Promise<PublishOut> {
  const at = now.toISOString();
  const { meta } = await db
    .prepare(
      `UPDATE publishes
       SET status = ?1,
           message = ?2,
           url = CASE WHEN ?3 = '' THEN url ELSE ?3 END,
           updated_at = ?4,
           active = CASE WHEN ?1 = 'running' THEN 1 ELSE NULL END,
           finished_at = CASE WHEN ?1 = 'running' THEN NULL ELSE ?4 END
       WHERE id = ?5 AND active = 1`,
    )
    .bind(update.status, update.message, update.url, at, id)
    .run();
  const row = await getPublishRow(db, id);
  if (!row) throw notFound("publish");
  if (meta.changes !== 1) throw conflict("publish_finished", "This publish has already finished.");
  return publishOut(row);
}

export async function failStalePublishes(db: D1Database, now: Date): Promise<number> {
  const at = now.toISOString();
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
  const { meta } = await db
    .prepare(
      `UPDATE publishes
       SET status = 'failed', active = NULL, finished_at = ?, updated_at = ?,
           message = 'The publish stopped reporting and was given up on.'
       WHERE active = 1 AND updated_at < ?`,
    )
    .bind(at, at, cutoff)
    .run();
  return meta.changes;
}

export async function latestPublish(db: D1Database): Promise<PublishOut | null> {
  const row = await db.prepare("SELECT * FROM publishes ORDER BY started_at DESC, id DESC LIMIT 1").first<PublishRow>();
  return row ? publishOut(row) : null;
}

export async function lastPublishedSnapshot(db: D1Database): Promise<{ snapshot: Snapshot; finishedAt: string } | null> {
  const row = await db
    .prepare(
      `SELECT snapshot, finished_at FROM publishes
       WHERE target = 'production' AND status = 'succeeded'
       ORDER BY finished_at DESC LIMIT 1`,
    )
    .first<{ snapshot: string; finished_at: string }>();
  return row ? { snapshot: JSON.parse(row.snapshot) as Snapshot, finishedAt: row.finished_at } : null;
}

export async function publishState(db: D1Database, now: Date): Promise<PublishState> {
  await failStalePublishes(db, now);
  const [{ snapshot, problems }, latest, published] = await Promise.all([
    buildSnapshot(db),
    latestPublish(db),
    lastPublishedSnapshot(db),
  ]);
  return {
    latest,
    published: published ? { finishedAt: published.finishedAt } : null,
    unpublishedChanges: problems.length === 0 && (!published || !sameSnapshot(published.snapshot, snapshot)),
    problems,
    summary: summarize(snapshot),
  };
}

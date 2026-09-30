import { Hono } from "hono";
import { z } from "zod";
import { getPublishRow, lastPublishedSnapshot, recordStatus } from "../db/publishes";
import type { Snapshot } from "../db/snapshot";
import type { AppEnv } from "../env";
import { requireService } from "../lib/auth";
import { ApiError, badRequest, conflict, notFound } from "../lib/errors";
import { parse, readJson } from "../lib/request";
import { declaredLength, putStreamed } from "../lib/storage";

const HASH = /^[0-9a-f]{64}$/;
const DERIVED_FILE = /^(?:[1-9]\d{0,4}\.(?:avif|jpg)|meta\.json)$/;
export const MAX_DERIVED_BYTES = 40 * 1024 * 1024;
const TYPES: Record<string, string> = { avif: "image/avif", jpg: "image/jpeg", json: "application/json" };

const statusSchema = z
  .object({
    status: z.enum(["running", "succeeded", "failed"]),
    message: z.string().max(2000).default(""),
    url: z.union([z.literal(""), z.string().max(500).regex(/^https:\/\/\S+$/, "must be an https address")]).default(""),
  })
  .strict();

/** The R2 key of one cached file, after checking both parts are the expected shape. */
function derivedKey(hash: string, file: string): { key: string; contentType: string } {
  if (!HASH.test(hash)) throw badRequest("invalid", "hash must be 64 lowercase hexadecimal characters");
  if (!DERIVED_FILE.test(file)) throw badRequest("invalid", "file must be <width>.avif, <width>.jpg, or meta.json");
  return { key: `derived/${hash}/${file}`, contentType: TYPES[file.split(".").pop()!]! };
}

/**
 * Everything the publish workflow may do, and nothing else: read the
 * snapshot of the publish it was started for, report on it, fetch the
 * originals that publish names, and read and fill the cache of generated
 * images.
 */
export const service = new Hono<AppEnv>();
service.use("*", requireService);

service.get("/publishes/:id/snapshot", async (c) => {
  const row = await getPublishRow(c.env.DB, c.req.param("id"));
  if (!row) throw notFound("publish");
  return c.json({ id: row.id, target: row.target, snapshot: JSON.parse(row.snapshot) as Snapshot });
});

service.post("/publishes/:id/status", async (c) => {
  const update = parse(statusSchema, await readJson(c.req.raw));
  return c.json(await recordStatus(c.env.DB, c.req.param("id"), update, new Date()));
});

service.get("/publishes/:id/originals/:hash", async (c) => {
  const row = await getPublishRow(c.env.DB, c.req.param("id"));
  if (!row) throw notFound("publish");
  if (row.active !== 1) throw conflict("publish_finished", "This publish has already finished.");

  const hash = c.req.param("hash");
  const snapshot = JSON.parse(row.snapshot) as Snapshot;
  const named = snapshot.categories.some((category) => category.photos.some((photo) => photo.contentHash === hash));
  if (!named) throw notFound("photograph");

  const photo = await c.env.DB.prepare("SELECT original_key, content_type FROM photos WHERE content_hash = ?")
    .bind(hash)
    .first<{ original_key: string; content_type: string }>();
  if (!photo) throw notFound("photograph");
  const object = await c.env.BUCKET.get(photo.original_key);
  if (!object) throw notFound("original");
  return new Response(object.body, {
    headers: {
      "content-type": photo.content_type,
      "content-length": String(object.size),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
});

service.get("/derived/:hash/:file", async (c) => {
  const { key, contentType } = derivedKey(c.req.param("hash"), c.req.param("file"));
  const object = await c.env.BUCKET.get(key);
  if (!object) throw notFound("file");
  return new Response(object.body, {
    headers: {
      "content-type": contentType,
      "content-length": String(object.size),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
});

service.put("/derived/:hash/:file", async (c) => {
  const hash = c.req.param("hash");
  const { key, contentType } = derivedKey(hash, c.req.param("file"));
  const length = declaredLength(c.req.raw);
  if (length === null || length === 0 || !c.req.raw.body) throw badRequest("invalid", "Send the file with its length.");
  if (length > MAX_DERIVED_BYTES) throw new ApiError(413, "too_large", "The file is larger than 40 MB.");

  const owner = () => c.env.DB.prepare("SELECT 1 FROM photos WHERE content_hash = ?").bind(hash).first();
  if (!(await owner())) throw notFound("photograph");

  await putStreamed(c.env.BUCKET, c.executionCtx, key, c.req.raw.body, length, { httpMetadata: { contentType } });

  // Whoever removes a photograph's row removes its files. If the photograph
  // was deleted while this file was on its way, that delete may have run
  // before the file landed, so the file is removed here rather than orphaned.
  if (!(await owner())) {
    await c.env.BUCKET.delete(key);
    throw notFound("photograph");
  }
  return c.body(null, 204);
});

service.get("/published", async (c) => {
  const published = await lastPublishedSnapshot(c.env.DB);
  if (!published) throw notFound("published snapshot");
  return c.json(published);
});

import { Hono } from "hono";
import { z } from "zod";
import { getCategory } from "../db/categories";
import { isUniqueViolation } from "../db/errors";
import { getPhoto } from "../db/photos";
import { getUpload, originalKey, previewKey, removeUpload } from "../db/uploads";
import type { AppEnv, Env } from "../env";
import { ApiError, badRequest, conflict, notFound } from "../lib/errors";
import { parse, readJson } from "../lib/request";

export const MAX_ORIGINAL_BYTES = 60 * 1024 * 1024;
export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/heic", "image/heif"]);
const DAY_MS = 24 * 60 * 60 * 1000;

const declareSchema = z.object({
  categoryId: z.string().min(1),
  originalName: z.string().trim().min(1, "must not be empty").max(200),
  contentType: z.string(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lowercase hexadecimal characters"),
  size: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

function fileName(originalName: string): string {
  const last = originalName.split(/[\\/]/).pop() ?? "";
  return last.trim() || "photograph";
}

function declaredLength(request: Request): number | null {
  const header = request.headers.get("content-length");
  if (!header || !/^\d+$/.test(header)) return null;
  return Number(header);
}

/**
 * Streams `body` into R2 at `key` through a `FixedLengthStream` of the declared
 * `length`. The Worker's own memory only ever holds whatever chunk is currently
 * in flight — the stream is piped straight through, never buffered or read into
 * an ArrayBuffer — and R2 is told the exact byte count up front rather than
 * relying on it being inferable from the incoming request's stream.
 */
function putStreamed(
  bucket: R2Bucket,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  key: string,
  body: ReadableStream<Uint8Array>,
  length: number,
  options: R2PutOptions,
): Promise<R2Object> {
  const fixed = new FixedLengthStream(length);
  ctx.waitUntil(body.pipeTo(fixed.writable).catch(() => {}));
  return bucket.put(key, fixed.readable, options);
}

/**
 * Records that a file for upload `id` has been stored at `key`. If the upload's
 * row was removed while the file was being stored (the nightly cleanup, or a
 * re-declaration of the same file), the row's remover has already deleted
 * whatever was at `key` — possibly before this file landed — so this deletes
 * the file just stored rather than leave it orphaned, and answers 404.
 *
 * The one exception is a row removed by `complete`: the key then belongs to
 * the photograph it created, and is left alone. Once the row is gone no
 * photograph can be created from it any more, so if none exists now, none
 * will, and the file is an orphan.
 */
async function markStored(env: Pick<Env, "DB" | "BUCKET">, id: string, column: "has_original" | "has_preview", key: string) {
  const { meta } = await env.DB.prepare(`UPDATE uploads SET ${column} = 1 WHERE id = ?`).bind(id).run();
  if (meta.changes === 1) return;
  const photograph = await env.DB.prepare("SELECT 1 FROM photos WHERE id = ?").bind(id).first();
  if (!photograph) await env.BUCKET.delete(key);
  throw notFound("upload");
}

/**
 * Reverses a failed send (a declared hash or length that didn't match, or any
 * other storage error): downgrades the upload's claim on `column`
 * (`has_original`/`has_preview`) back to 0, so `complete` can never build a
 * photograph out of bytes that were never verified. The object at `key` is
 * deleted only when nothing had verified a file there yet.
 *
 * A rejected R2 put stores nothing, so whatever currently sits at `key` was
 * placed there by an EARLIER, different send — deleting it unconditionally
 * (as this code used to) either destroys that earlier send's still-good file,
 * or, once `complete` has already run for it, a finished photograph's file.
 * The first UPDATE below only matches when `column` is CURRENTLY 0: nothing
 * has verified a file at `key` yet (this is the first attempt for this
 * upload, or an earlier attempt also failed), so whatever is there — usually
 * nothing — is safe to remove. When `column` is 1, an earlier send's
 * verified file is there, and the second, unconditional UPDATE still
 * downgrades the claim without touching the file. If the row is gone
 * altogether (removed by `complete` or the nightly cleanup), neither UPDATE
 * matches anything, and the key is left to whoever owns it now.
 */
async function revertFailedSend(env: Pick<Env, "DB" | "BUCKET">, id: string, column: "has_original" | "has_preview", key: string): Promise<void> {
  const { meta } = await env.DB.prepare(`UPDATE uploads SET ${column} = 0 WHERE id = ? AND ${column} = 0`).bind(id).run();
  if (meta.changes === 1) {
    await env.BUCKET.delete(key);
    return;
  }
  await env.DB.prepare(`UPDATE uploads SET ${column} = 0 WHERE id = ?`).bind(id).run();
}

export async function cleanUpStaleUploads(env: Pick<Env, "DB" | "BUCKET">, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - DAY_MS).toISOString();
  const { results } = await env.DB.prepare("SELECT id FROM uploads WHERE created_at < ?").bind(cutoff).all<{ id: string }>();
  let removed = 0;
  for (const { id } of results) {
    if (await removeUpload(env.DB, env.BUCKET, id)) removed += 1;
  }
  return removed;
}

export const uploads = new Hono<AppEnv>();

uploads.post("/", async (c) => {
  const input = parse(declareSchema, await readJson(c.req.raw));
  if (!TYPES.has(input.contentType)) {
    throw new ApiError(415, "unsupported_type", "Upload a JPEG, PNG, or HEIC photograph.");
  }
  if (input.size > MAX_ORIGINAL_BYTES) {
    throw new ApiError(413, "too_large", "A photograph can be at most 60 MB.");
  }
  if (!(await getCategory(c.env.DB, input.categoryId))) throw notFound("category");

  const existing = await c.env.DB.prepare("SELECT id, title FROM photos WHERE content_hash = ?")
    .bind(input.contentHash)
    .first<{ id: string; title: string }>();
  if (existing) {
    throw conflict("duplicate", "This photograph is already in the library.", {
      photoId: existing.id,
      title: existing.title,
    });
  }

  const pending = await c.env.DB.prepare("SELECT id FROM uploads WHERE content_hash = ?")
    .bind(input.contentHash)
    .first<{ id: string }>();
  if (pending) await removeUpload(c.env.DB, c.env.BUCKET, pending.id);

  const id = crypto.randomUUID();
  const name = fileName(input.originalName);
  const now = new Date().toISOString();
  const insertUpload = () =>
    c.env.DB.prepare(
      `INSERT INTO uploads (id, category_id, original_name, content_type, content_hash, size, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, input.categoryId, name, input.contentType, input.contentHash, input.size, input.width, input.height, now)
      .run();

  try {
    await insertUpload();
  } catch (error) {
    // The pre-check above is best-effort: two declarations of the same new
    // file can both find no pending upload and both reach this INSERT, so
    // whichever lands second collides with the first's row on this UNIQUE
    // constraint. Behave as if we had arrived second: remove the pending
    // upload that now exists for this hash (its row and any stored files)
    // and insert again, once. Any other insert failure still propagates.
    if (!isUniqueViolation(error, "uploads.content_hash")) throw error;
    const racedPending = await c.env.DB.prepare("SELECT id FROM uploads WHERE content_hash = ?")
      .bind(input.contentHash)
      .first<{ id: string }>();
    if (racedPending) await removeUpload(c.env.DB, c.env.BUCKET, racedPending.id);
    try {
      await insertUpload();
    } catch {
      throw conflict("upload_in_progress", "This photograph is already being uploaded. Try again in a moment.");
    }
  }
  return c.json({ id }, 201);
});

uploads.put("/:id/original", async (c) => {
  const id = c.req.param("id");
  const upload = await getUpload(c.env.DB, id);
  if (!upload) throw notFound("upload");
  const length = declaredLength(c.req.raw);
  if (length === null || length !== upload.size || !c.req.raw.body) {
    await c.req.raw.body?.cancel();
    await revertFailedSend(c.env, id, "has_original", originalKey(id));
    throw badRequest("size_mismatch", "The file's size differs from the size that was declared.");
  }
  try {
    await putStreamed(c.env.BUCKET, c.executionCtx, originalKey(id), c.req.raw.body, upload.size, {
      httpMetadata: { contentType: upload.content_type },
      sha256: upload.content_hash,
    });
  } catch (error) {
    await revertFailedSend(c.env, id, "has_original", originalKey(id));
    // FixedLengthStream itself raises a TypeError when the stream it wraps
    // supplies more or fewer bytes than the declared length — distinct from
    // R2's own plain Error when the bytes it received don't match `sha256`.
    // A body that arrived short or long (a dropped connection) is a size
    // problem, not a hash problem, so only the latter is `hash_mismatch`.
    if (error instanceof TypeError) {
      throw badRequest("size_mismatch", "The file's size differs from the size that was declared.");
    }
    throw badRequest("hash_mismatch", "The file that arrived is not the file that was declared. Try again.");
  }
  await markStored(c.env, id, "has_original", originalKey(id));
  return c.body(null, 204);
});

uploads.put("/:id/preview", async (c) => {
  const id = c.req.param("id");
  const upload = await getUpload(c.env.DB, id);
  if (!upload) throw notFound("upload");
  if ((c.req.header("content-type") ?? "").split(";")[0]!.trim() !== "image/jpeg") {
    throw new ApiError(415, "unsupported_type", "A preview must be a JPEG.");
  }
  const length = declaredLength(c.req.raw);
  if (length === null || !c.req.raw.body) {
    await revertFailedSend(c.env, id, "has_preview", previewKey(id));
    throw badRequest("size_mismatch", "The preview's size is missing.");
  }
  if (length > MAX_PREVIEW_BYTES) throw new ApiError(413, "too_large", "A preview can be at most 2 MB.");

  try {
    await putStreamed(c.env.BUCKET, c.executionCtx, previewKey(id), c.req.raw.body, length, {
      httpMetadata: { contentType: "image/jpeg" },
    });
  } catch {
    // The preview has no declared hash to check against, so every storage
    // failure here comes from FixedLengthStream rejecting a body that was
    // shorter or longer than the declared `content-length` (a truncated or
    // otherwise mismatched upload) — always a size problem.
    await revertFailedSend(c.env, id, "has_preview", previewKey(id));
    throw badRequest("size_mismatch", "The preview's size differs from the size that was declared.");
  }
  await markStored(c.env, id, "has_preview", previewKey(id));
  return c.body(null, 204);
});

uploads.post("/:id/complete", async (c) => {
  const id = c.req.param("id");
  const upload = await getUpload(c.env.DB, id);
  if (!upload) throw notFound("upload");
  if (!upload.has_original || !upload.has_preview) {
    throw conflict("upload_incomplete", "Both the photograph and its preview must arrive before finishing.");
  }
  const now = new Date().toISOString();
  let inserted: number;
  try {
    // The photograph is built from the upload row as it is at the moment the
    // batch runs, not from the copy read above: if the row has been removed
    // since (the nightly cleanup or a re-declaration, which then delete the
    // files), the SELECT finds nothing and no photograph is created whose
    // files are gone. D1 runs a batch's statements in order inside one
    // transaction, so the INSERT reads the row before the DELETE removes it,
    // and the DELETE only removes a row the INSERT has just turned into a
    // photograph.
    const [insert] = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO photos (id, category_id, text_status, original_key, preview_key, original_name, content_type,
           content_hash, width, height, source, created_at, updated_at)
         SELECT id, category_id, 'needs_text', ?, ?, original_name, content_type,
                content_hash, width, height, 'upload', ?, ?
           FROM uploads
          WHERE id = ? AND has_original = 1 AND has_preview = 1`,
      ).bind(originalKey(id), previewKey(id), now, now, id),
      c.env.DB.prepare("DELETE FROM uploads WHERE id = ? AND EXISTS (SELECT 1 FROM photos WHERE photos.id = uploads.id)").bind(id),
    ]);
    inserted = insert!.meta.changes;
  } catch (error) {
    // `photos.id` and `photos.content_hash` are both unique. A second `complete`
    // for the same upload normally finds the row already gone and inserts
    // nothing (answered below), but if its INSERT does collide with the
    // photograph the first one created, the whole batch (including its DELETE
    // of the upload row) is rolled back, and the request is indistinguishable
    // from one that arrived after the upload was completed — so it gets the
    // same 404. Anything else is a genuine failure and surfaces as a 500.
    if (isUniqueViolation(error, "photos.id") || isUniqueViolation(error, "photos.content_hash")) throw notFound("upload");
    throw error;
  }
  // No row was inserted: the upload row vanished between the check above and
  // the batch (removed, or already completed by a concurrent request). Its
  // files are left to whoever removed the row.
  if (inserted !== 1) throw notFound("upload");
  const photo = await getPhoto(c.env.DB, id);
  if (!photo) throw notFound("upload");
  return c.json(photo, 201);
});

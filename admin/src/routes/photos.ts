import { Hono } from "hono";
import { z } from "zod";
import { getCategory } from "../db/categories";
import { isUniqueViolation } from "../db/errors";
import {
  getPhoto,
  getPhotoRow,
  listPhotos,
  photoOut,
  renumberSelection,
  renumberStatements,
  selectedIds,
  slugsInCategory,
} from "../db/photos";
import type { AppEnv } from "../env";
import { badRequest, conflict, notFound } from "../lib/errors";
import { parse, readJson } from "../lib/request";
import { slugify, uniqueSlug } from "../lib/slug";

const STARTS_WITH_MEDIUM = /^(?:an?\s+)?(?:photo(?:graph)?|image|picture)\s+of\b/i;

// R2's delete() historically limits how many keys it accepts in one call (1000);
// chunk any longer list so a photograph with many derived files still deletes cleanly.
const R2_DELETE_BATCH_SIZE = 1000;

export const textSchema = z.object({
  title: z.string().trim().min(1, "must not be empty").max(60, "must be at most 60 characters"),
  alt: z
    .string()
    .trim()
    .min(1, "must not be empty")
    .max(200, "must be at most 200 characters")
    .refine((value) => !STARTS_WITH_MEDIUM.test(value), 'must describe what is visible, not begin with "photo of"'),
  description: z.string().trim().min(1, "must not be empty").max(400, "must be at most 400 characters"),
});
const selectedSchema = z.object({ selected: z.boolean() });
const orderSchema = z.object({ ids: z.array(z.string()) });
const moveSchema = z.object({ categoryId: z.string().min(1) });

// A photograph's address is chosen from the slugs read a moment earlier, so a
// concurrent approval or move into the same category can claim the same one
// first; the `photos_slug_in_category` index (which SQLite names by its
// columns) then refuses this write. Nothing was written, and trying again
// picks a free address.
async function claimingSlug<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error, "photos.category_id, photos.slug")) {
      throw conflict("slug_taken", "Another photograph in this category already uses that address. Try again.");
    }
    throw error;
  }
}

async function deleteAll(bucket: R2Bucket, keys: string[]): Promise<void> {
  for (let index = 0; index < keys.length; index += R2_DELETE_BATCH_SIZE) {
    await bucket.delete(keys.slice(index, index + R2_DELETE_BATCH_SIZE));
  }
}

/** Lists and deletes everything stored under `derived/<hash>/`. */
async function sweepDerived(bucket: R2Bucket, contentHash: string): Promise<void> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix: `derived/${contentHash}/`, cursor });
    keys.push(...listed.objects.map((object) => object.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  await deleteAll(bucket, keys);
}

export const photos = new Hono<AppEnv>();
export const categoryPhotos = new Hono<AppEnv>();

categoryPhotos.get("/:id/photos", async (c) => {
  const id = c.req.param("id");
  if (!(await getCategory(c.env.DB, id))) throw notFound("category");
  return c.json({ photos: await listPhotos(c.env.DB, id) });
});

categoryPhotos.put("/:id/selection-order", async (c) => {
  const id = c.req.param("id");
  if (!(await getCategory(c.env.DB, id))) throw notFound("category");
  const { ids } = parse(orderSchema, await readJson(c.req.raw));
  const current = await selectedIds(c.env.DB, id);
  const same = ids.length === current.length && new Set(ids).size === ids.length && ids.every((x) => current.includes(x));
  if (!same) throw badRequest("order_mismatch", "The order must list every selected photograph exactly once.");
  // Single write: renumberSelection batches its own updates atomically (see db/photos.ts).
  await renumberSelection(c.env.DB, id, ids);
  return c.json({ photos: await listPhotos(c.env.DB, id) });
});

photos.get("/:id", async (c) => {
  const photo = await getPhoto(c.env.DB, c.req.param("id"));
  if (!photo) throw notFound("photograph");
  return c.json(photo);
});

photos.get("/:id/preview", async (c) => {
  const row = await getPhotoRow(c.env.DB, c.req.param("id"));
  if (!row) throw notFound("photograph");
  const object = await c.env.BUCKET.get(row.preview_key);
  if (!object) throw notFound("preview");
  return new Response(object.body, {
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" },
  });
});

photos.put("/:id/text", async (c) => {
  const id = c.req.param("id");
  const row = await getPhotoRow(c.env.DB, id);
  if (!row) throw notFound("photograph");
  const input = parse(textSchema, await readJson(c.req.raw));
  const slug = row.slug ?? uniqueSlug(slugify(input.title), await slugsInCategory(c.env.DB, row.category_id, id));
  // Single row write: no other row is touched by approving text, so no batch is needed.
  await claimingSlug(() =>
    c.env.DB.prepare(
      "UPDATE photos SET title = ?, alt = ?, description = ?, slug = ?, text_status = 'approved', updated_at = ? WHERE id = ?",
    )
      .bind(input.title, input.alt, input.description, slug, new Date().toISOString(), id)
      .run(),
  );
  return c.json(await getPhoto(c.env.DB, id));
});

photos.put("/:id/selected", async (c) => {
  const id = c.req.param("id");
  const row = await getPhotoRow(c.env.DB, id);
  if (!row) throw notFound("photograph");
  const { selected } = parse(selectedSchema, await readJson(c.req.raw));
  const now = new Date().toISOString();

  if (selected && row.selected === 0) {
    // Single statement: the count of already-shown photographs and the write that
    // shows this one happen inside one UPDATE, so two concurrent selections can never
    // compute the same next position — D1 runs the statement (subquery included)
    // atomically, so a second request's count can only see the first request's write
    // already landed, never a state in between. A category may show any number.
    //
    // The subquery is correlated to `photos.category_id` — the updated row's OWN
    // category at the moment this statement runs — rather than a category id bound
    // from the earlier `getPhotoRow` read above. If another request moves this same
    // photograph to a different category between that read and this UPDATE, it is
    // still numbered within wherever the row actually is when the statement executes,
    // never the category it used to be in.
    const result = await c.env.DB.prepare(
      `UPDATE photos
         SET selected = 1,
             position = (SELECT COUNT(*) FROM photos AS other WHERE other.category_id = photos.category_id AND other.selected = 1) + 1,
             updated_at = ?
       WHERE id = ?
         AND selected = 0
         AND text_status = 'approved'`,
    )
      .bind(now, id)
      .run();

    if (result.meta.changes === 0) {
      const current = await getPhotoRow(c.env.DB, id);
      if (!current) throw notFound("photograph");
      if (current.selected === 1) return c.json(photoOut(current));
      throw conflict("text_not_approved", "Approve this photograph's title and descriptions before selecting it.");
    }
  } else if (!selected && row.selected === 1) {
    const remaining = (await selectedIds(c.env.DB, row.category_id)).filter((existing) => existing !== id);
    // Batched: the deselect and the renumbering of the rest must land together, or a
    // request interrupted between them would leave two selected photographs sharing
    // position 0 (this one) or a gap where this one used to sit.
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE photos SET selected = 0, position = 0, updated_at = ? WHERE id = ?").bind(now, id),
      ...renumberStatements(c.env.DB, remaining),
    ]);
  }
  return c.json(await getPhoto(c.env.DB, id));
});

photos.put("/:id/category", async (c) => {
  const id = c.req.param("id");
  const row = await getPhotoRow(c.env.DB, id);
  if (!row) throw notFound("photograph");
  const { categoryId } = parse(moveSchema, await readJson(c.req.raw));
  if (!(await getCategory(c.env.DB, categoryId))) throw notFound("category");

  if (categoryId !== row.category_id) {
    const slug = row.slug ? uniqueSlug(row.slug, await slugsInCategory(c.env.DB, categoryId)) : null;
    const remaining = (await selectedIds(c.env.DB, row.category_id)).filter((existing) => existing !== id);
    const now = new Date().toISOString();
    // Batched: moving deselects the photograph (it starts unselected in its new
    // category) and must renumber the old category's remaining selections in the
    // same commit, or an interruption would leave the old category's selected
    // photographs sharing this one's vacated position, or gapped.
    await claimingSlug(() =>
      c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE photos SET category_id = ?, slug = ?, selected = 0, position = 0, updated_at = ? WHERE id = ?",
        ).bind(categoryId, slug, now, id),
        ...renumberStatements(c.env.DB, remaining),
      ]),
    );
  }
  return c.json(await getPhoto(c.env.DB, id));
});

photos.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await getPhotoRow(c.env.DB, id);
  if (!row) throw notFound("photograph");

  // Files are removed before the database row: the owner's concern is a withdrawn,
  // private photograph's files lingering in storage, so we would rather risk a
  // dangling row (files already gone, row still present — safe, and the delete can
  // simply be retried) than the reverse (row gone, files orphaned in R2 with nothing
  // in the API able to find or remove them again).
  await deleteAll(c.env.BUCKET, [row.original_key, row.preview_key]);
  await sweepDerived(c.env.BUCKET, row.content_hash);

  const remaining = (await selectedIds(c.env.DB, row.category_id)).filter((existing) => existing !== id);
  // Batched: the row delete and the renumbering of the category's remaining
  // selections must land together, or an interruption would leave the category's
  // selected photographs gapped where this one used to sit.
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM photos WHERE id = ?").bind(id),
    ...renumberStatements(c.env.DB, remaining),
  ]);
  // A generated file may have been stored while this delete was running: the
  // workflow's PUT checks the row, stores, then checks again, and can pass both
  // checks before the row above was removed yet land after the first sweep
  // listed the prefix. Once the row is gone no new file is kept (the PUT
  // removes its own), so one more pass here finds every file that slipped in.
  // The delete is complete by now: a failure here must not become a 500 that a
  // retry would then answer with 404.
  try {
    await sweepDerived(c.env.BUCKET, row.content_hash);
  } catch (error) {
    console.error("Could not sweep generated files after deleting a photograph", error);
  }
  return c.body(null, 204);
});

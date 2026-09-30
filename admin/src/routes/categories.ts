import { Hono } from "hono";
import { z } from "zod";
import { getCategory, listCategories } from "../db/categories";
import { isUniqueViolation } from "../db/errors";
import { removeUpload } from "../db/uploads";
import type { AppEnv } from "../env";
import { badRequest, conflict, notFound } from "../lib/errors";
import { parse, readJson } from "../lib/request";
import { SLUG_PATTERN, slugify } from "../lib/slug";

const RESERVED = new Set(["colophon", "photos", "assets", "api", "404"]);

const text = (max: number) => z.string().trim().min(1, "must not be empty").max(max, `must be at most ${max} characters`);
const fields = { title: text(60), place: text(40), description: text(300) };

const createSchema = z.object({
  ...fields,
  slug: z.string().regex(SLUG_PATTERN, "must be lowercase words joined by hyphens").optional(),
});
const updateSchema = z
  .object({ ...fields, hidden: z.boolean() })
  .partial()
  .strict();
const orderSchema = z.object({ ids: z.array(z.string()) });

export const categories = new Hono<AppEnv>();

categories.get("/", async (c) => c.json({ categories: await listCategories(c.env.DB) }));

categories.post("/", async (c) => {
  const input = parse(createSchema, await readJson(c.req.raw));
  const slug = input.slug ?? slugify(input.title);
  if (RESERVED.has(slug)) throw badRequest("slug_reserved", `The address "${slug}" is used by the site itself.`);

  const taken = await c.env.DB.prepare("SELECT 1 FROM categories WHERE slug = ?").bind(slug).first();
  if (taken) throw conflict("slug_taken", `Another category already uses the address "${slug}".`);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await c.env.DB.prepare(
      `INSERT INTO categories (id, slug, title, place, description, position, hidden, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM categories), 0, ?, ?)`,
    )
      .bind(id, slug, input.title, input.place, input.description, now, now)
      .run();
  } catch (error) {
    // The pre-check above is best-effort: a second request for the same
    // address can pass it before the first one's insert lands. The UNIQUE
    // constraint is the actual source of truth, so a violation here still
    // answers 409 rather than letting a D1 error surface as a 500.
    if (isUniqueViolation(error, "categories.slug")) {
      throw conflict("slug_taken", `Another category already uses the address "${slug}".`);
    }
    throw error;
  }
  return c.json(await getCategory(c.env.DB, id), 201);
});

categories.put("/order", async (c) => {
  const { ids } = parse(orderSchema, await readJson(c.req.raw));
  const existing = (await listCategories(c.env.DB)).map((category) => category.id);
  const same = ids.length === existing.length && new Set(ids).size === ids.length && ids.every((id) => existing.includes(id));
  if (!same) throw badRequest("order_mismatch", "The order must list every category exactly once.");

  const now = new Date().toISOString();
  await c.env.DB.batch(
    ids.map((id, index) =>
      c.env.DB.prepare("UPDATE categories SET position = ?, updated_at = ? WHERE id = ?").bind(index + 1, now, id),
    ),
  );
  return c.json({ categories: await listCategories(c.env.DB) });
});

categories.patch("/:id", async (c) => {
  const raw = await readJson(c.req.raw);
  if (raw && typeof raw === "object" && "slug" in raw) {
    throw badRequest("slug_fixed", "A category's address cannot be changed after it is created.");
  }
  const input = parse(updateSchema, raw);
  const id = c.req.param("id");
  const current = await getCategory(c.env.DB, id);
  if (!current) throw notFound("category");

  await c.env.DB.prepare(
    "UPDATE categories SET title = ?, place = ?, description = ?, hidden = ?, updated_at = ? WHERE id = ?",
  )
    .bind(
      input.title ?? current.title,
      input.place ?? current.place,
      input.description ?? current.description,
      (input.hidden ?? current.hidden) ? 1 : 0,
      new Date().toISOString(),
      id,
    )
    .run();
  return c.json(await getCategory(c.env.DB, id));
});

categories.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const current = await getCategory(c.env.DB, id);
  if (!current) throw notFound("category");
  if (current.photoCount > 0) {
    throw conflict("category_not_empty", "Move or delete this category's photographs first.");
  }
  // A pending upload (an abandoned one, awaiting the nightly cleanup) still
  // references the category, so it goes first, with its files.
  const { results: pending } = await c.env.DB.prepare("SELECT id FROM uploads WHERE category_id = ?")
    .bind(id)
    .all<{ id: string }>();
  for (const upload of pending) await removeUpload(c.env.DB, c.env.BUCKET, upload.id);
  await c.env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(id).run();
  return c.body(null, 204);
});

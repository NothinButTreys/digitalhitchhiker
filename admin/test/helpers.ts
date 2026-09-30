import { applyD1Migrations, env, SELF } from "cloudflare:test";
import type { CategoryOut } from "../src/db/categories";

export const OWNER = "owner@example.com";

export async function resetDb(): Promise<void> {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM publishes"),
    env.DB.prepare("DELETE FROM uploads"),
    env.DB.prepare("DELETE FROM photos"),
    env.DB.prepare("DELETE FROM categories"),
  ]);
  const listed = await env.BUCKET.list();
  await Promise.all(listed.objects.map((object) => env.BUCKET.delete(object.key)));
}

type Init = Omit<RequestInit, "body"> & { json?: unknown; body?: BodyInit | null; as?: string | null };

export async function api(path: string, init: Init = {}): Promise<Response> {
  const { json, as = OWNER, headers, ...rest } = init;
  const merged = new Headers(headers);
  if (as) merged.set("x-dev-email", as);
  let body = rest.body;
  if (json !== undefined) {
    merged.set("content-type", "application/json");
    body = JSON.stringify(json);
  }
  return SELF.fetch(`https://admin.test${path}`, { ...rest, headers: merged, body });
}

let seedCounter = 0;

export async function seedCategory(overrides: Record<string, unknown> = {}): Promise<CategoryOut> {
  seedCounter += 1;
  const response = await api("/api/categories", {
    method: "POST",
    json: { title: `Category ${seedCounter}`, place: "Arizona", description: "A set.", ...overrides },
  });
  if (response.status !== 201) throw new Error(`seedCategory failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as CategoryOut;
}

type PhotoSeed = {
  slug: string | null;
  title: string;
  alt: string;
  description: string;
  text_status: "needs_text" | "approved";
  selected: 0 | 1;
  position: number;
  created_at: string;
};

export async function seedPhoto(categoryId: string, overrides: Partial<PhotoSeed> = {}): Promise<string> {
  seedCounter += 1;
  const id = `photo-${seedCounter}`;
  const row: PhotoSeed = {
    slug: null,
    title: "",
    alt: "",
    description: "",
    text_status: "needs_text",
    selected: 0,
    position: 0,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, seedCounter)).toISOString(),
    ...overrides,
  };
  await env.DB.prepare(
    `INSERT INTO photos (id, category_id, slug, title, alt, description, text_status, selected, position,
       original_key, preview_key, original_name, content_type, content_hash, width, height, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'image/jpeg', ?, 3000, 2000, 'upload', ?, ?)`,
  )
    .bind(
      id, categoryId, row.slug, row.title, row.alt, row.description, row.text_status,
      row.selected, row.position, `originals/${id}`, `previews/${id}.jpg`, `${id}.jpg`, `hash-${id}`,
      row.created_at, row.created_at,
    )
    .run();
  await env.BUCKET.put(`originals/${id}`, "original-bytes");
  await env.BUCKET.put(`previews/${id}.jpg`, "preview-bytes", { httpMetadata: { contentType: "image/jpeg" } });
  return id;
}

export const approved = { text_status: "approved" as const, title: "T", alt: "Something visible here now", description: "D." };

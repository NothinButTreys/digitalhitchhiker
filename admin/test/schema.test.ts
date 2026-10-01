import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers";

beforeEach(resetDb);

const now = "2026-09-29T00:00:00.000Z";
const category = (id: string, slug: string) =>
  env.DB.prepare(
    "INSERT INTO categories (id, slug, title, place, description, position, created_at, updated_at) VALUES (?, ?, 'T', 'P', 'D', 1, ?, ?)",
  ).bind(id, slug, now, now);
const photo = (id: string, categoryId: string, slug: string | null, hash: string, status = "needs_text") =>
  env.DB.prepare(
    "INSERT INTO photos (id, category_id, slug, text_status, original_key, preview_key, original_name, content_type, content_hash, width, height, source, created_at, updated_at) VALUES (?, ?, ?, ?, 'o', 'p', 'n.jpg', 'image/jpeg', ?, 10, 10, 'upload', ?, ?)",
  ).bind(id, categoryId, slug, status, hash, now, now);

describe("schema", () => {
  it("refuses a duplicate category slug", async () => {
    await category("c1", "desert").run();
    await expect(category("c2", "desert").run()).rejects.toThrow();
  });

  it("refuses a duplicate photo slug inside one category but allows it across categories", async () => {
    await category("c1", "desert").run();
    await category("c2", "city").run();
    await photo("p1", "c1", "tower", "h1").run();
    await expect(photo("p2", "c1", "tower", "h2").run()).rejects.toThrow();
    await photo("p3", "c2", "tower", "h3").run();
  });

  it("allows many photos with no slug in one category", async () => {
    await category("c1", "desert").run();
    await photo("p1", "c1", null, "h1").run();
    await photo("p2", "c1", null, "h2").run();
  });

  it("refuses a duplicate content hash", async () => {
    await category("c1", "desert").run();
    await photo("p1", "c1", null, "same").run();
    await expect(photo("p2", "c1", null, "same").run()).rejects.toThrow();
  });

  it("refuses an unknown text status", async () => {
    await category("c1", "desert").run();
    await expect(photo("p1", "c1", null, "h1", "bogus").run()).rejects.toThrow();
  });
});

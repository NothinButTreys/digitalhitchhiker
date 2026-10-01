import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { isUniqueViolation } from "../src/db/errors";
import { approved, resetDb, seedCategory, seedPhoto } from "./helpers";

beforeEach(resetDb);

async function failureOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the statement to fail");
}

describe("isUniqueViolation", () => {
  it("recognises D1's own error for a UNIQUE column, by that column only", async () => {
    const category = await seedCategory();
    const error = await failureOf(() =>
      env.DB.prepare(
        "INSERT INTO categories (id, slug, title, place, description, position, created_at, updated_at) VALUES ('x', ?, 'T', 'P', 'D', 9, 'a', 'a')",
      )
        .bind(category.slug)
        .run(),
    );

    expect(isUniqueViolation(error, "categories.slug")).toBe(true);
    expect(isUniqueViolation(error, "categories")).toBe(false);
    expect(isUniqueViolation(error, "categories.sl")).toBe(false);
    expect(isUniqueViolation(error, "photos.content_hash")).toBe(false);
  });

  it("recognises D1's own error for the photograph address index, which SQLite names by its columns", async () => {
    const category = await seedCategory();
    await seedPhoto(category.id, { ...approved, slug: "tiger" });
    const other = await seedPhoto(category.id);
    const error = await failureOf(() => env.DB.prepare("UPDATE photos SET slug = 'tiger' WHERE id = ?").bind(other).run());

    expect(isUniqueViolation(error, "photos.category_id, photos.slug")).toBe(true);
    expect(isUniqueViolation(error, "photos.slug")).toBe(false);
    expect(isUniqueViolation(error, "photos.category_id")).toBe(false);
  });

  it("does not mistake another constraint for a UNIQUE violation", async () => {
    const category = await seedCategory();
    await seedPhoto(category.id);
    const error = await failureOf(() => env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(category.id).run());

    expect(error).toBeInstanceOf(Error);
    expect(isUniqueViolation(error, "categories.id")).toBe(false);
    expect(isUniqueViolation(error, "photos.category_id")).toBe(false);
  });

  it("matches a message with or without D1's trailing code, and an index SQLite names as such", () => {
    expect(isUniqueViolation(new Error("D1_ERROR: UNIQUE constraint failed: uploads.content_hash"), "uploads.content_hash")).toBe(true);
    expect(
      isUniqueViolation(
        new Error("D1_ERROR: UNIQUE constraint failed: uploads.content_hash: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)"),
        "uploads.content_hash",
      ),
    ).toBe(true);
    expect(isUniqueViolation(new Error("UNIQUE constraint failed: index 'photos_slug_in_category'"), "photos_slug_in_category")).toBe(true);
    expect(isUniqueViolation(new Error("UNIQUE constraint failed: index 'photos_slug_in_category'"), "photos_slug")).toBe(false);
  });

  it("answers false for anything that is not an Error", () => {
    expect(isUniqueViolation("UNIQUE constraint failed: categories.slug", "categories.slug")).toBe(false);
    expect(isUniqueViolation({ message: "UNIQUE constraint failed: categories.slug" }, "categories.slug")).toBe(false);
    expect(isUniqueViolation(null, "categories.slug")).toBe(false);
    expect(isUniqueViolation(undefined, "categories.slug")).toBe(false);
  });
});

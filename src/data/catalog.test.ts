import { describe, expect, it } from "vitest";
import { buildCatalog } from "./catalog";

const photo = (slug: string) => ({
  slug,
  source: `Set/${slug}.jpg`,
  title: `Title ${slug}`,
  alt: `Alt ${slug}`,
  description: `Description ${slug}`,
});
const set = (slug: string, photos: string[]) => ({
  file: `content/sets/${slug}.json`,
  raw: { slug, title: slug, place: "Arizona", description: `About ${slug}`, photos: photos.map(photo) },
});
const entry = { width: 2000, height: 1333, widths: [640, 1280, 2000], color: "#112233" };

describe("buildCatalog", () => {
  it("orders sets by the given order and joins manifest data", () => {
    const catalog = buildCatalog({
      sets: [set("b", ["two"]), set("a", ["one", "three"])],
      manifest: { "a/one": entry, "a/three": entry, "b/two": entry },
      order: ["a", "b"],
    });
    expect(catalog.sets.map((s) => s.slug)).toEqual(["a", "b"]);
    expect(catalog.sets[0]?.photos[1]).toMatchObject({
      slug: "three",
      setSlug: "a",
      index: 1,
      width: 2000,
      color: "#112233",
    });
  });

  it("leaves each original's file name out of the photos it returns", () => {
    const catalog = buildCatalog({
      sets: [set("a", ["one"])],
      manifest: { "a/one": entry },
      order: ["a"],
    });
    expect(catalog.sets[0]?.photos[0]).not.toHaveProperty("source");
  });

  it("fails when a photo has no manifest entry", () => {
    expect(() =>
      buildCatalog({ sets: [set("a", ["one"])], manifest: {}, order: ["a"] }),
    ).toThrow("content/sets/a.json: photo \"one\" has no entry \"a/one\" in manifest.json; publish from the library, or run `npm run library:pull`");
  });

  it("fails on a duplicate photo slug within a set", () => {
    expect(() =>
      buildCatalog({ sets: [set("a", ["one", "one"])], manifest: { "a/one": entry }, order: ["a"] }),
    ).toThrow("content/sets/a.json: duplicate photo slug \"one\"");
  });

  it("fails when the order names a set with no content file", () => {
    expect(() => buildCatalog({ sets: [], manifest: {}, order: ["a"] })).toThrow(
      "set \"a\" is in SITE.setOrder but has no content file",
    );
  });

  it("fails when a content file is missing from the order", () => {
    expect(() =>
      buildCatalog({ sets: [set("a", ["one"])], manifest: { "a/one": entry }, order: [] }),
    ).toThrow("content/sets/a.json: set \"a\" is not listed in SITE.setOrder");
  });
});

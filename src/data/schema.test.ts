import { describe, expect, it } from "vitest";
import { parseManifest, parseSetContent, parseSetOrder } from "./schema";

const validSet = {
  slug: "phoenix-zoo",
  title: "Phoenix Zoo",
  place: "Arizona",
  description: "Animals at the Phoenix Zoo.",
  photos: [
    {
      slug: "tiger",
      source: "Phoenix Zoo/fam-10.JPG",
      title: "Tiger",
      alt: "A tiger resting and looking at the camera",
      description: "A tiger at rest in its enclosure.",
    },
  ],
};

describe("parseSetContent", () => {
  it("returns the content when valid", () => {
    expect(parseSetContent(validSet, "content/sets/phoenix-zoo.json")).toEqual(validSet);
  });

  it("names the file and field when alt is empty", () => {
    const bad = { ...validSet, photos: [{ ...validSet.photos[0], alt: "  " }] };
    expect(() => parseSetContent(bad, "content/sets/phoenix-zoo.json")).toThrow(
      /content\/sets\/phoenix-zoo\.json: photos\.0\.alt: /,
    );
  });

  it("rejects an empty description", () => {
    const bad = { ...validSet, photos: [{ ...validSet.photos[0], description: "" }] };
    expect(() => parseSetContent(bad, "x.json")).toThrow(/photos\.0\.description/);
  });

  it("rejects a slug with capitals or spaces", () => {
    expect(() => parseSetContent({ ...validSet, slug: "Phoenix Zoo" }, "x.json")).toThrow(
      /x\.json: slug: /,
    );
  });

  it("rejects unknown fields", () => {
    expect(() => parseSetContent({ ...validSet, extra: 1 }, "x.json")).toThrow(/x\.json/);
  });
});

describe("parseManifest", () => {
  it("accepts a valid manifest", () => {
    const m = { "phoenix-zoo/tiger": { width: 2000, height: 1333, widths: [640, 1280, 2000], color: "#3a2f1c" } };
    expect(parseManifest(m)).toEqual(m);
  });

  it("rejects a bad colour", () => {
    const m = { "a/b": { width: 1, height: 1, widths: [1], color: "red" } };
    expect(() => parseManifest(m)).toThrow(/manifest\.json: a\/b\.color/);
  });
});

describe("parseSetOrder", () => {
  it("reads the order of the sets", () => {
    expect(parseSetOrder(["phoenix-zoo", "montreal"])).toEqual(["phoenix-zoo", "montreal"]);
  });

  it("refuses an order that is empty, repeats a set, or is not a list of slugs", () => {
    expect(() => parseSetOrder([])).toThrow(/content\/set-order\.json: .*must list at least one set/);
    expect(() => parseSetOrder(["a", "a"])).toThrow('content/set-order.json: lists "a" more than once');
    expect(() => parseSetOrder(["Phoenix Zoo"])).toThrow(/content\/set-order\.json: 0: /);
    expect(() => parseSetOrder({ order: [] })).toThrow(/content\/set-order\.json: /);
  });
});

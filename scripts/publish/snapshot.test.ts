import { describe, expect, it } from "vitest";
import { parseSnapshot } from "./snapshot";

const photo = {
  slug: "tiger",
  title: "Tiger",
  alt: "A tiger resting in dry grass",
  description: "A tiger rests.",
  contentHash: "a".repeat(64),
  contentType: "image/jpeg",
  originalName: "IMG_0001.jpg",
};
const valid = {
  version: 1,
  categories: [{ slug: "phoenix-zoo", title: "Phoenix Zoo", place: "Arizona", description: "Animals.", photos: [photo] }],
};

describe("parseSnapshot", () => {
  it("accepts a well-formed snapshot", () => {
    expect(parseSnapshot(valid)).toEqual(valid);
  });

  it("accepts a category showing more than eight photographs", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ({ ...photo, slug: `p-${i}` }));
    const snapshot = { ...valid, categories: [{ ...valid.categories[0], photos: twelve }] };
    expect(parseSnapshot(snapshot).categories[0]!.photos).toHaveLength(12);
  });

  it.each([
    ["a newer version", { ...valid, version: 2 }],
    ["no categories", { ...valid, categories: [] }],
    ["a category with no photographs", { ...valid, categories: [{ ...valid.categories[0], photos: [] }] }],
    ["a slug that is not an address", { ...valid, categories: [{ ...valid.categories[0], slug: "Phoenix Zoo" }] }],
    ["a hash that is not a hash", { ...valid, categories: [{ ...valid.categories[0], photos: [{ ...photo, contentHash: "../../etc" }] }] }],
    ["empty alt text", { ...valid, categories: [{ ...valid.categories[0], photos: [{ ...photo, alt: " " }] }] }],
    ["an unexpected field", { ...valid, extra: true }],
  ])("refuses %s", (_name, raw) => {
    expect(() => parseSnapshot(raw)).toThrow(/^The library sent a snapshot this build cannot use: /);
  });
});

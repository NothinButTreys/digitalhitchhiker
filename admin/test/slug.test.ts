import { describe, expect, it } from "vitest";
import { SLUG_PATTERN, slugify, uniqueSlug } from "../src/lib/slug";

describe("slugify", () => {
  it.each([
    ["Superstition Mountains", "superstition-mountains"],
    ["Montréal", "montreal"],
    ["  The  Scott!! ", "the-scott"],
    ["Old town, snow", "old-town-snow"],
    ["Façade — night", "facade-night"],
    ["2019", "2019"],
    ["???", "photo"],
    ["", "photo"],
  ])("%j becomes %j", (input, expected) => {
    expect(slugify(input)).toBe(expected);
    expect(slugify(input)).toMatch(SLUG_PATTERN);
  });
});

describe("uniqueSlug", () => {
  it("returns the base when it is free", () => {
    expect(uniqueSlug("tiger", new Set(["zebra"]))).toBe("tiger");
  });

  it("adds the first free number", () => {
    expect(uniqueSlug("tiger", new Set(["tiger"]))).toBe("tiger-2");
    expect(uniqueSlug("tiger", new Set(["tiger", "tiger-2", "tiger-3"]))).toBe("tiger-4");
  });
});

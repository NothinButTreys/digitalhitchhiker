import { describe, expect, it } from "vitest";
import { fixture } from "./fixture";
import { allPaths, nextSet, photoPath, resolve, setPath } from "./routes";

describe("resolve", () => {
  it("resolves the root to the first set as home", () => {
    const resolved = resolve(fixture, "/");
    expect(resolved).toMatchObject({ kind: "set", isHome: true });
    expect(resolved.kind === "set" && resolved.set.slug).toBe("desert");
  });

  it("resolves a set path", () => {
    expect(resolve(fixture, "/city")).toMatchObject({ kind: "set", isHome: false });
  });

  it("ignores a trailing slash", () => {
    expect(resolve(fixture, "/city/").kind).toBe("set");
  });

  it("resolves a photo path", () => {
    const resolved = resolve(fixture, "/desert/two");
    expect(resolved.kind === "photo" && resolved.photo.index).toBe(1);
  });

  it("resolves the colophon", () => {
    expect(resolve(fixture, "/colophon").kind).toBe("colophon");
  });

  it.each(["/nope", "/desert/nope", "/desert/one/extra", "/404"])("resolves %s as not found", (path) => {
    expect(resolve(fixture, path).kind).toBe("notFound");
  });
});

describe("paths", () => {
  it("builds set and photo paths", () => {
    expect(setPath({ slug: "city" })).toBe("/city");
    expect(photoPath({ setSlug: "city", slug: "three" })).toBe("/city/three");
  });

  it("lists every route", () => {
    expect(allPaths(fixture)).toEqual([
      "/", "/desert", "/desert/one", "/desert/two", "/city", "/city/three", "/colophon",
    ]);
  });

  it("wraps from the last set to the first", () => {
    expect(nextSet(fixture, "desert").slug).toBe("city");
    expect(nextSet(fixture, "city").slug).toBe("desert");
  });
});

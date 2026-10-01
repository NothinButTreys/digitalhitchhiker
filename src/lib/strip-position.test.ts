// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { forgetPositionUnless, recallPosition, rememberPosition } from "./strip-position";

beforeEach(() => window.sessionStorage.clear());

describe("strip position", () => {
  it("recalls nothing for a set that was never scrolled", () => {
    expect(recallPosition("desert")).toBeNull();
  });

  it("recalls where a set's strip was left", () => {
    rememberPosition("desert", 1234.4);
    expect(recallPosition("desert")).toBe(1234);
  });

  it("does not hand one set's position to another", () => {
    rememberPosition("desert", 900);
    expect(recallPosition("city")).toBeNull();
  });

  it("keeps only the latest set, so an earlier one starts from its first photograph", () => {
    rememberPosition("desert", 900);
    rememberPosition("city", 300);
    expect(recallPosition("desert")).toBeNull();
    expect(recallPosition("city")).toBe(300);
  });

  it("forgets the position once the visitor is somewhere other than that set", () => {
    rememberPosition("desert", 900);
    forgetPositionUnless("city");
    expect(recallPosition("desert")).toBeNull();
  });

  it("forgets the position on a page that belongs to no set", () => {
    rememberPosition("desert", 900);
    forgetPositionUnless(null);
    expect(recallPosition("desert")).toBeNull();
  });

  it("keeps the position while the visitor stays in the set", () => {
    rememberPosition("desert", 900);
    forgetPositionUnless("desert");
    expect(recallPosition("desert")).toBe(900);
  });

  it("treats the very start as nothing to recall", () => {
    rememberPosition("desert", 0);
    expect(recallPosition("desert")).toBeNull();
  });

  it("ignores a damaged record", () => {
    window.sessionStorage.setItem("dh:strip", "{not json");
    expect(recallPosition("desert")).toBeNull();
    window.sessionStorage.setItem("dh:strip", JSON.stringify({ slug: "desert", position: "far" }));
    expect(recallPosition("desert")).toBeNull();
  });
});

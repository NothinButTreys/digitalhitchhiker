import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeUnexpected } from "./prune";

let root: string;

function put(relative: string, body = "x") {
  const full = path.join(root, relative);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "dh-prune-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("removeUnexpected", () => {
  it("removes files under public/photos that are not expected and reports them", async () => {
    put("public/photos/zoo/tiger-640.avif");
    put("public/photos/zoo/tiger-2880.avif");
    put("public/photos/zoo/gone-640.avif");
    put("public/photos/old-set/bear-640.jpg");

    const removed = await removeUnexpected(
      root,
      new Set(["public/photos/zoo/tiger-640.avif", "public/photos/zoo/tiger-2880.avif"]),
    );

    expect(removed).toEqual(["public/photos/old-set/bear-640.jpg", "public/photos/zoo/gone-640.avif"]);
    expect(existsSync(path.join(root, "public/photos/zoo/tiger-640.avif"))).toBe(true);
    expect(existsSync(path.join(root, "public/photos/zoo/tiger-2880.avif"))).toBe(true);
    expect(existsSync(path.join(root, "public/photos/zoo/gone-640.avif"))).toBe(false);
    expect(existsSync(path.join(root, "public/photos/old-set/bear-640.jpg"))).toBe(false);
  });

  it("never removes anything outside public/photos, even through links", async () => {
    put("public/favicon.svg", "icon");
    put("src/data/manifest.json", "{}");
    put("outside/original.jpg", "original");
    put("public/photos/zoo/tiger-640.avif");
    symlinkSync(path.join(root, "outside/original.jpg"), path.join(root, "public/photos/zoo/linked-640.jpg"));
    symlinkSync(path.join(root, "outside"), path.join(root, "public/photos/linked-set"));

    const removed = await removeUnexpected(root, new Set(["public/photos/zoo/nothing-expected.avif"]));

    expect(removed).toEqual(["public/photos/zoo/tiger-640.avif"]);
    expect(readFileSync(path.join(root, "public/favicon.svg"), "utf8")).toBe("icon");
    expect(readFileSync(path.join(root, "src/data/manifest.json"), "utf8")).toBe("{}");
    expect(readFileSync(path.join(root, "outside/original.jpg"), "utf8")).toBe("original");
  });

  it("does nothing when public/photos does not exist", async () => {
    put("public/favicon.svg");
    expect(await removeUnexpected(root, new Set(["public/photos/zoo/tiger-640.avif"]))).toEqual([]);
    expect(existsSync(path.join(root, "public/favicon.svg"))).toBe(true);
  });

  it("throws and deletes nothing when the expected set is empty", async () => {
    put("public/photos/zoo/tiger-640.avif");

    await expect(removeUnexpected(root, new Set())).rejects.toThrow(/empty/i);

    expect(existsSync(path.join(root, "public/photos/zoo/tiger-640.avif"))).toBe(true);
  });
});

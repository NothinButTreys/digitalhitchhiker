import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compareToCommitted } from "./compare";

let root: string;
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd: root, stdio: "pipe" });
const write = async (file: string, body: string) => {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), body);
};
const set = (source: string, title = "Tiger") =>
  `${JSON.stringify({ slug: "zoo", title: "Zoo", place: "Arizona", description: "Animals.", photos: [{ slug: "tiger", source, title, alt: "A tiger", description: "A tiger." }] }, null, 2)}\n`;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "dh-compare-"));
  git("init", "--quiet");
});
afterEach(() => rm(root, { recursive: true, force: true }));

async function commitSite() {
  await write("content/sets/zoo.json", set("Phoenix Zoo/IMG_1.jpg"));
  await write("content/set-order.json", '[\n  "zoo"\n]\n');
  await write("src/data/manifest.json", "{}\n");
  await write("public/photos/zoo/tiger-640.jpg", "image bytes");
  git("add", ".");
  git("commit", "--quiet", "-m", "site");
}

describe("compareToCommitted", () => {
  it("has nothing to compare with when no content is committed", async () => {
    await write("README.md", "hello");
    git("add", ".");
    git("commit", "--quiet", "-m", "empty");
    expect(await compareToCommitted(root)).toBeNull();
  });

  it("finds no difference when only the original's recorded name differs", async () => {
    await commitSite();
    await write("content/sets/zoo.json", set("IMG_1.jpg"));
    expect(await compareToCommitted(root)).toEqual([]);
  });

  it("reports changed text, a changed image, a new image, a missing image, and a changed order or manifest", async () => {
    await commitSite();
    await write("content/sets/zoo.json", set("IMG_1.jpg", "Tigress"));
    await write("public/photos/zoo/tiger-640.jpg", "other bytes");
    await write("public/photos/zoo/tiger-1280.jpg", "new");
    await write("content/set-order.json", '[\n  "zoo",\n  "city"\n]\n');
    await write("src/data/manifest.json", '{"zoo/tiger":{}}\n');
    await write("content/sets/city.json", set("x.jpg"));
    expect(await compareToCommitted(root)).toEqual([
      "content/set-order.json differs",
      "content/sets/city.json is new",
      "content/sets/zoo.json differs",
      "public/photos/zoo/tiger-1280.jpg is new",
      "public/photos/zoo/tiger-640.jpg differs",
      "src/data/manifest.json differs",
    ]);
  });

  it("reports a committed file that was not generated", async () => {
    await commitSite();
    await rm(path.join(root, "public/photos/zoo/tiger-640.jpg"));
    await rm(path.join(root, "content/sets/zoo.json"));
    expect(await compareToCommitted(root)).toEqual([
      "content/sets/zoo.json is missing",
      "public/photos/zoo/tiger-640.jpg is missing",
    ]);
  });
});

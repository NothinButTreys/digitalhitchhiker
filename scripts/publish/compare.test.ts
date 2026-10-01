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

const twoPhotos = (photos: Array<{ slug: string; title: string }>, source = "x.jpg") =>
  `${JSON.stringify({ slug: "zoo", title: "Zoo", place: "Arizona", description: "Animals.", photos: photos.map((photo) => ({ ...photo, source, alt: "Alt", description: "D." })) }, null, 2)}\n`;

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

  it("accepts a library that shows fewer photographs and fewer sets than the site, when what it shows is unchanged", async () => {
    const tiger = { slug: "tiger", title: "Tiger" };
    const egret = { slug: "egret", title: "Egret" };
    const zebra = { slug: "zebra", title: "Zebra" };
    await write("content/sets/zoo.json", twoPhotos([tiger, egret, zebra], "Phoenix Zoo/a.jpg"));
    await write("content/sets/city.json", set("City/x.jpg"));
    await write("content/set-order.json", '[\n  "city",\n  "zoo"\n]\n');
    await write("src/data/manifest.json", JSON.stringify({ "zoo/tiger": { width: 1 }, "zoo/egret": { width: 2 }, "zoo/zebra": { width: 3 }, "city/tiger": { width: 4 } }));
    for (const name of ["tiger", "egret", "zebra"]) await write(`public/photos/zoo/${name}-640.jpg`, `${name} bytes`);
    await write("public/photos/city/tiger-640.jpg", "city bytes");
    git("add", ".");
    git("commit", "--quiet", "-m", "site");

    // The library shows the tiger and the zebra, in that order, and no city set at all.
    await write("content/sets/zoo.json", twoPhotos([tiger, zebra], "a.jpg"));
    await rm(path.join(root, "content/sets/city.json"));
    await write("content/set-order.json", '[\n  "zoo"\n]\n');
    await write("src/data/manifest.json", JSON.stringify({ "zoo/tiger": { width: 1 }, "zoo/zebra": { width: 3 } }));
    await rm(path.join(root, "public/photos/zoo/egret-640.jpg"));
    await rm(path.join(root, "public/photos/city"), { recursive: true });
    expect(await compareToCommitted(root)).toEqual([]);

    // The same photographs in another order are not the same site.
    await write("content/sets/zoo.json", twoPhotos([zebra, tiger], "a.jpg"));
    expect(await compareToCommitted(root)).toEqual(["content/sets/zoo.json differs"]);

    // Nor is a photograph the site never had.
    await write("content/sets/zoo.json", twoPhotos([tiger, { slug: "lion", title: "Lion" }], "a.jpg"));
    expect(await compareToCommitted(root)).toEqual(["content/sets/zoo.json differs"]);
  });

  it("reports changed text, a changed image, a new image, a new set, and a changed order or manifest entry", async () => {
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

  it("reports a set whose title, place or description changed", async () => {
    await commitSite();
    await write("content/sets/zoo.json", set("IMG_1.jpg").replace('"Arizona"', '"Nevada"'));
    expect(await compareToCommitted(root)).toEqual(["content/sets/zoo.json differs"]);
  });

  it("reports the committed order rearranged", async () => {
    await commitSite();
    await write("content/sets/city.json", set("x.jpg"));
    await write("content/set-order.json", '[\n  "zoo",\n  "city"\n]\n');
    git("add", ".");
    git("commit", "--quiet", "-m", "two sets");
    await write("content/set-order.json", '[\n  "city",\n  "zoo"\n]\n');
    expect(await compareToCommitted(root)).toEqual(["content/set-order.json differs"]);
  });
});

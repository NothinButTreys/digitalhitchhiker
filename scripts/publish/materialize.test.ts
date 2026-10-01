import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Encoded } from "../lib/encode";
import type { DerivedStore, OriginalSource } from "./library";
import { materialize, type Encoder } from "./materialize";
import type { Snapshot } from "./snapshot";

const hash = (letter: string) => letter.repeat(64);
const photo = (slug: string, letter: string, contentType = "image/jpeg") => ({
  slug,
  title: `Title of ${slug}`,
  alt: `Alt of ${slug}`,
  description: `Description of ${slug}.`,
  contentHash: hash(letter),
  contentType,
  originalName: `IMG_${letter}.jpg`,
});

// Two categories and three photographs, the fixture the design asks for.
const snapshot: Snapshot = {
  version: 1,
  categories: [
    { slug: "desert", title: "Desert", place: "Arizona", description: "Dry places.", photos: [photo("cairn", "a"), photo("ridge", "b")] },
    { slug: "city", title: "City", place: "Québec", description: "Streets.", photos: [photo("lane", "c", "image/heic")] },
  ],
};

let root: string;
let workDir: string;
let cache: Map<string, Buffer>;
let store: DerivedStore;
let originals: OriginalSource & { downloads: string[] };
let encode: Encoder & { calls: string[] };

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "dh-site-"));
  workDir = await mkdtemp(path.join(os.tmpdir(), "dh-work-"));
  cache = new Map();
  store = {
    getDerived: async (h, file) => cache.get(`${h}/${file}`) ?? null,
    putDerived: async (h, file, body) => void cache.set(`${h}/${file}`, body),
  };
  const downloads: string[] = [];
  originals = {
    downloads,
    downloadOriginal: async (h, toFile) => {
      downloads.push(path.basename(toFile));
      await writeFile(toFile, `original ${h[0]}`);
    },
  };
  const calls: string[] = [];
  // Stands in for the real encoder: two widths, tiny files whose contents say
  // which original and which size they came from.
  const fake = async (source: string, outDir: string): Promise<Encoded> => {
    calls.push(path.basename(source));
    const letter = (await readFile(source, "utf8")).at(-1)!;
    const files = ["640.avif", "900.avif", "640.jpg", "900.jpg"];
    for (const name of files) await writeFile(path.join(outDir, name), `${letter}:${name}`);
    return { entry: { width: 900, height: 600, widths: [640, 900], color: "#112233" }, files };
  };
  encode = Object.assign(fake, { calls });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(workDir, { recursive: true, force: true });
});

const run = (overrides: Partial<Parameters<typeof materialize>[0]> = {}) =>
  materialize({ snapshot, store, originals, root, workDir, encode, ...overrides });
const read = (file: string) => readFile(path.join(root, file), "utf8");

describe("materialize", () => {
  it("writes the content files, the order, the manifest, and every image, from a cold cache", async () => {
    const result = await run();
    expect(result).toEqual({ categories: 2, photographs: 3, encoded: 3, removed: [] });

    expect(JSON.parse(await read("content/set-order.json"))).toEqual(["desert", "city"]);
    expect((await read("content/set-order.json")).endsWith("]\n")).toBe(true);
    expect(JSON.parse(await read("content/sets/desert.json"))).toEqual({
      slug: "desert",
      title: "Desert",
      place: "Arizona",
      description: "Dry places.",
      photos: [
        { slug: "cairn", source: "IMG_a.jpg", title: "Title of cairn", alt: "Alt of cairn", description: "Description of cairn." },
        { slug: "ridge", source: "IMG_b.jpg", title: "Title of ridge", alt: "Alt of ridge", description: "Description of ridge." },
      ],
    });
    expect((await readdir(path.join(root, "content/sets"))).sort()).toEqual(["city.json", "desert.json"]);

    const manifest = JSON.parse(await read("src/data/manifest.json"));
    expect(Object.keys(manifest)).toEqual(["city/lane", "desert/cairn", "desert/ridge"]);
    expect(manifest["desert/cairn"]).toEqual({ width: 900, height: 600, widths: [640, 900], color: "#112233" });
    expect(await read("src/data/manifest.json")).toBe(`${JSON.stringify(manifest, null, 2)}\n`);

    expect((await readdir(path.join(root, "public/photos/desert"))).sort()).toEqual([
      "cairn-640.avif", "cairn-640.jpg", "cairn-900.avif", "cairn-900.jpg",
      "ridge-640.avif", "ridge-640.jpg", "ridge-900.avif", "ridge-900.jpg",
    ]);
    expect(await read("public/photos/desert/ridge-900.avif")).toBe("b:900.avif");
    expect(await read("public/photos/city/lane-640.jpg")).toBe("c:640.jpg");
  });

  it("names the downloaded original by its hash and type, never by its own name, and cleans up after itself", async () => {
    await run();
    expect(originals.downloads).toEqual([`${hash("a")}.jpg`, `${hash("b")}.jpg`, `${hash("c")}.heic`]);
    expect(encode.calls).toEqual(originals.downloads);
    expect(await readdir(workDir)).toEqual([]);
  });

  it("fills the cache, writing the entry last so that its presence means the images are all there", async () => {
    const order: string[] = [];
    const recording: DerivedStore = { ...store, putDerived: async (h, file, body) => { order.push(`${h[0]}/${file}`); await store.putDerived(h, file, body); } };
    await run({ store: recording });
    expect(order.slice(0, 5)).toEqual(["a/640.avif", "a/900.avif", "a/640.jpg", "a/900.jpg", "a/meta.json"]);
    expect(JSON.parse(cache.get(`${hash("a")}/meta.json`)!.toString())).toEqual({ width: 900, height: 600, widths: [640, 900], color: "#112233" });
  });

  it("encodes nothing the second time", async () => {
    await run();
    encode.calls.length = 0;
    originals.downloads.length = 0;
    const again = await mkdtemp(path.join(os.tmpdir(), "dh-site-again-"));
    try {
      const result = await run({ root: again });
      expect(result.encoded).toBe(0);
      expect(encode.calls).toEqual([]);
      expect(originals.downloads).toEqual([]);
      expect(await readFile(path.join(again, "public/photos/desert/ridge-900.avif"), "utf8")).toBe("b:900.avif");
    } finally {
      await rm(again, { recursive: true, force: true });
    }
  });

  it("encodes again when the cache has the entry but is missing an image", async () => {
    await run();
    cache.delete(`${hash("b")}/900.jpg`);
    encode.calls.length = 0;
    const result = await run();
    expect(result.encoded).toBe(1);
    expect(encode.calls).toEqual([`${hash("b")}.jpg`]);
    expect(cache.has(`${hash("b")}/900.jpg`)).toBe(true);
  });

  it("removes what the snapshot no longer shows: a dropped photograph's images and a dropped category's files", async () => {
    await run();
    const smaller: Snapshot = { version: 1, categories: [{ ...snapshot.categories[0]!, photos: [snapshot.categories[0]!.photos[0]!] }] };
    const result = await run({ snapshot: smaller });
    expect(result.removed).toEqual([
      "public/photos/city/lane-640.avif", "public/photos/city/lane-640.jpg", "public/photos/city/lane-900.avif", "public/photos/city/lane-900.jpg",
      "public/photos/desert/ridge-640.avif", "public/photos/desert/ridge-640.jpg", "public/photos/desert/ridge-900.avif", "public/photos/desert/ridge-900.jpg",
    ]);
    expect(await readdir(path.join(root, "content/sets"))).toEqual(["desert.json"]);
    expect(JSON.parse(await read("content/set-order.json"))).toEqual(["desert"]);
    expect(Object.keys(JSON.parse(await read("src/data/manifest.json")))).toEqual(["desert/cairn"]);
  });

  it("leaves other files in the content folder alone", async () => {
    await mkdir(path.join(root, "content/sets"), { recursive: true });
    await writeFile(path.join(root, "content/sets/notes.txt"), "keep");
    await run();
    expect(await read("content/sets/notes.txt")).toBe("keep");
  });

  it("reports progress after each photograph", async () => {
    const onProgress = vi.fn();
    await run({ onProgress });
    expect(onProgress.mock.calls).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it("with no originals to fall back on, uses the cache and names what is missing by its address on the site", async () => {
    await run();
    const again = await mkdtemp(path.join(os.tmpdir(), "dh-site-pull-"));
    try {
      await expect(run({ root: again, originals: null })).resolves.toMatchObject({ encoded: 0, photographs: 3 });
      cache.delete(`${hash("c")}/meta.json`);
      await expect(run({ root: again, originals: null })).rejects.toThrow(
        'The images for "city/lane" are not in the cache yet. Publish from the admin once, then try again.',
      );
    } finally {
      await rm(again, { recursive: true, force: true });
    }
  });

  it("refuses an original of a type the pipeline cannot read, by its address on the site", async () => {
    const odd: Snapshot = { version: 1, categories: [{ ...snapshot.categories[0]!, photos: [photo("odd", "d", "image/gif")] }] };
    await expect(run({ snapshot: odd })).rejects.toThrow('"desert/odd" is an image/gif file, which the image pipeline cannot read.');
  });
});

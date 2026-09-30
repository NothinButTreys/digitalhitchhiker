import { mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseManifest, type Manifest, type ManifestEntry } from "../../src/data/schema";
import { derivedFiles, type Encoded } from "../lib/encode";
import { expectedFiles, outputFile } from "../lib/photo-plan";
import { removeUnexpected } from "../lib/prune";
import type { DerivedStore, OriginalSource } from "./library";
import type { Snapshot } from "./snapshot";

export type Encoder = (source: string, outDir: string, tmpDir: string) => Promise<Encoded>;

export type MaterializeInput = {
  snapshot: Snapshot;
  store: DerivedStore;
  /** Where originals come from when the cache has no images for one. Null when only the cache may be used. */
  originals: OriginalSource | null;
  /** The repository root the site is built from. */
  root: string;
  /** Scratch space for downloaded originals and freshly made images. Left empty. */
  workDir: string;
  encode: Encoder;
  onProgress?: (done: number, total: number) => void | Promise<void>;
};

export type MaterializeResult = { categories: number; photographs: number; encoded: number; removed: string[] };

// The downloaded original is named by its hash, never by its own name, with
// the extension the encoder goes by (HEIC is converted before it is read).
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/heic": ".heic",
  "image/heif": ".heic",
};

type Images = { entry: ManifestEntry; files: Map<string, Buffer> };

/** Everything the cache holds for one original, or null unless it is all there and readable. */
async function fromCache(store: DerivedStore, hash: string): Promise<Images | null> {
  const raw = await store.getDerived(hash, "meta.json");
  if (!raw) return null;
  let entry: ManifestEntry;
  try {
    entry = parseManifest({ entry: JSON.parse(raw.toString("utf8")) }).entry!;
  } catch {
    return null;
  }
  const files = new Map<string, Buffer>();
  for (const name of derivedFiles(entry)) {
    const body = await store.getDerived(hash, name);
    if (!body) return null;
    files.set(name, body);
  }
  return { entry, files };
}

/**
 * Turns a snapshot into exactly the files the site is built from: one
 * content file per category, the order, the manifest, and every image.
 * Images come from the cache; an original is downloaded and encoded only
 * when the cache does not already hold everything for it. Anything the
 * snapshot does not show is removed, so the folder never carries over a
 * photograph from an earlier publish.
 */
export async function materialize(input: MaterializeInput): Promise<MaterializeResult> {
  const { snapshot, store, originals, root, workDir, encode } = input;
  const total = snapshot.categories.reduce((sum, category) => sum + category.photos.length, 0);
  const manifest: Manifest = {};
  let done = 0;
  let encoded = 0;

  for (const category of snapshot.categories) {
    await mkdir(path.join(root, "public/photos", category.slug), { recursive: true });

    for (const photo of category.photos) {
      const address = `${category.slug}/${photo.slug}`;
      let images = await fromCache(store, photo.contentHash);

      if (!images) {
        if (!originals) {
          throw new Error(`The images for "${address}" are not in the cache yet. Publish from the admin once, then try again.`);
        }
        const extension = EXTENSIONS[photo.contentType];
        if (!extension) {
          throw new Error(`"${address}" is an ${photo.contentType} file, which the image pipeline cannot read.`);
        }
        const source = path.join(workDir, `${photo.contentHash}${extension}`);
        const outDir = path.join(workDir, photo.contentHash);
        await mkdir(outDir, { recursive: true });
        try {
          await originals.downloadOriginal(photo.contentHash, source);
          const result = await encode(source, outDir, workDir);
          const files = new Map<string, Buffer>();
          for (const name of result.files) {
            const body = await readFile(path.join(outDir, name));
            await store.putDerived(photo.contentHash, name, body);
            files.set(name, body);
          }
          // Last, so that an entry in the cache means every image is there.
          await store.putDerived(photo.contentHash, "meta.json", Buffer.from(JSON.stringify(result.entry)));
          images = { entry: result.entry, files };
          encoded += 1;
        } finally {
          await rm(outDir, { recursive: true, force: true });
          for (const leftover of await readdir(workDir)) {
            if (leftover.startsWith(photo.contentHash)) await rm(path.join(workDir, leftover), { recursive: true, force: true });
          }
        }
      }

      for (const [name, body] of images.files) {
        const [width, ext] = name.split(".") as [string, "avif" | "jpg"];
        await writeFile(path.join(root, outputFile(category.slug, photo.slug, Number(width), ext)), body);
      }
      manifest[address] = images.entry;
      done += 1;
      await input.onProgress?.(done, total);
    }
  }

  const setsDir = path.join(root, "content/sets");
  await mkdir(setsDir, { recursive: true });
  const written = new Set<string>();
  for (const category of snapshot.categories) {
    const file = `${category.slug}.json`;
    written.add(file);
    const content = {
      slug: category.slug,
      title: category.title,
      place: category.place,
      description: category.description,
      // `source` is the original's file name. The bundler strips it from
      // what the site ships, and the build checks use it to prove that.
      photos: category.photos.map((photo) => ({
        slug: photo.slug,
        source: photo.originalName,
        title: photo.title,
        alt: photo.alt,
        description: photo.description,
      })),
    };
    await writeFile(path.join(setsDir, file), `${JSON.stringify(content, null, 2)}\n`);
  }
  for (const existing of await readdir(setsDir)) {
    if (existing.endsWith(".json") && !written.has(existing)) await unlink(path.join(setsDir, existing));
  }

  const order = snapshot.categories.map((category) => category.slug);
  await writeFile(path.join(root, "content/set-order.json"), `${JSON.stringify(order, null, 2)}\n`);

  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  await mkdir(path.join(root, "src/data"), { recursive: true });
  await writeFile(path.join(root, "src/data/manifest.json"), `${JSON.stringify(sorted, null, 2)}\n`);

  const removed = await removeUnexpected(root, expectedFiles(sorted));
  return { categories: snapshot.categories.length, photographs: total, encoded, removed };
}

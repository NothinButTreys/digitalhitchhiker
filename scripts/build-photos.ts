import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { widthsFor } from "../src/data/photo-url";
import { parseSetContent, type Manifest } from "../src/data/schema";
import {
  assertManifestNotEmpty,
  expectedFiles,
  isStale,
  outputFile,
  requireSource,
} from "./lib/photo-plan";
import { encodeVariant, manifestEntry, measure, readable } from "./lib/encode";
import { removeUnexpected } from "./lib/prune";

const ORIGINALS =
  process.env.DH_ORIGINALS ?? path.join(os.homedir(), "Pictures/Digital Hitchhiker/Originals");
const CONTENT_DIR = "content/sets";
const MANIFEST_FILE = "src/data/manifest.json";

async function mtime(file: string): Promise<number | null> {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

async function build(tmpDir: string) {
  const manifest: Manifest = {};
  const files = (await readdir(CONTENT_DIR)).filter((name) => name.endsWith(".json")).sort();
  let written = 0;

  for (const name of files) {
    const file = path.join(CONTENT_DIR, name);
    const set = parseSetContent(JSON.parse(await readFile(file, "utf8")), file);
    await mkdir(path.join("public/photos", set.slug), { recursive: true });

    for (const photo of set.photos) {
      const source = path.join(ORIGINALS, requireSource(photo, file));
      const sourceMtime = await mtime(source);
      if (sourceMtime === null) {
        throw new Error(`${file}: photo "${photo.slug}": original not found at ${source}`);
      }

      const input = await readable(source, tmpDir);
      const intrinsic = await measure(input);
      if (!intrinsic) {
        throw new Error(`${file}: photo "${photo.slug}": cannot read dimensions of ${source}`);
      }
      const entry = await manifestEntry(input, intrinsic);

      for (const ext of ["avif", "jpg"] as const) {
        for (const width of widthsFor(entry.widths, ext)) {
          const out = outputFile(set.slug, photo.slug, width, ext);
          if (!isStale(sourceMtime, await mtime(out))) continue;
          await encodeVariant(input, width, ext, out);
          written += 1;
        }
      }

      manifest[`${set.slug}/${photo.slug}`] = entry;
    }
  }

  assertManifestNotEmpty(manifest, CONTENT_DIR);

  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(MANIFEST_FILE, `${JSON.stringify(sorted, null, 2)}\n`);

  const removed = await removeUnexpected(process.cwd(), expectedFiles(sorted));
  for (const file of removed) console.log(`removed ${file}`);
  console.log(
    `${Object.keys(sorted).length} photos in manifest, ${written} files written, ${removed.length} files removed`,
  );
}

async function main() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "dh-photos-"));
  try {
    await build(tmpDir);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

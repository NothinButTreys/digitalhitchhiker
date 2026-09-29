import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { widthsFor } from "../src/data/photo-url";
import { parseSetContent, type Manifest } from "../src/data/schema";
import {
  expectedFiles,
  isStale,
  outputFile,
  outputWidths,
  requireSource,
  toHex,
} from "./lib/photo-plan";
import { removeUnexpected } from "./lib/prune";

const run = promisify(execFile);
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

async function readable(source: string, tmpDir: string): Promise<string> {
  if (!/\.heic$/i.test(source)) return source;
  const converted = path.join(tmpDir, `${path.basename(source)}.jpg`);
  await run("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "100", source, "--out", converted]);
  return converted;
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
      const meta = await sharp(input).metadata();
      const turned = (meta.orientation ?? 1) >= 5;
      const intrinsicWidth = turned ? meta.height : meta.width;
      const intrinsicHeight = turned ? meta.width : meta.height;
      if (!intrinsicWidth || !intrinsicHeight) {
        throw new Error(`${file}: photo "${photo.slug}": cannot read dimensions of ${source}`);
      }

      const widths = outputWidths(intrinsicWidth);
      for (const ext of ["avif", "jpg"] as const) {
        for (const width of widthsFor(widths, ext)) {
          const out = outputFile(set.slug, photo.slug, width, ext);
          if (!isStale(sourceMtime, await mtime(out))) continue;
          const resized = sharp(input)
            .rotate()
            .resize({ width, withoutEnlargement: true })
            .keepIccProfile();
          if (ext === "avif") {
            await resized.avif({ quality: 70, chromaSubsampling: "4:4:4", effort: 6 }).toFile(out);
          } else {
            await resized.jpeg({ quality: 88, mozjpeg: true }).toFile(out);
          }
          written += 1;
        }
      }

      const largest = Math.max(...widths);
      const { dominant } = await sharp(input).stats();
      manifest[`${set.slug}/${photo.slug}`] = {
        width: largest,
        height: Math.round((intrinsicHeight * largest) / intrinsicWidth),
        widths,
        color: toHex(dominant),
      };
    }
  }

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

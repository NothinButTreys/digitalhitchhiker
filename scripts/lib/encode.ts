import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { widthsFor, type ImageExt } from "../../src/data/photo-url";
import type { ManifestEntry } from "../../src/data/schema";
import { outputWidths, toHex } from "./photo-plan";

const run = promisify(execFile);

/**
 * A file sharp can read. sharp cannot decode HEIC, so a HEIC original is
 * first converted to a full-quality JPEG with macOS's `sips`; anything else
 * is used as it is.
 */
export async function readable(source: string, tmpDir: string): Promise<string> {
  if (!/\.hei[cf]$/i.test(source)) return source;
  const converted = path.join(tmpDir, `${path.basename(source)}.jpg`);
  await run("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "100", source, "--out", converted]);
  return converted;
}

/** The photograph's size as it is displayed: width and height swap when the orientation tag turns it. */
export async function measure(input: string): Promise<{ width: number; height: number } | null> {
  const meta = await sharp(input).metadata();
  const turned = (meta.orientation ?? 1) >= 5;
  const width = turned ? meta.height : meta.width;
  const height = turned ? meta.width : meta.height;
  return width && height ? { width, height } : null;
}

/**
 * The image settings, in the one place they are written down. Every
 * published image is made here: turned upright, resized, colour profile
 * kept, all other metadata (including location) left out.
 */
export async function encodeVariant(input: string, width: number, ext: ImageExt, out: string): Promise<void> {
  const resized = sharp(input).rotate().resize({ width, withoutEnlargement: true }).keepIccProfile();
  if (ext === "avif") {
    await resized.avif({ quality: 70, chromaSubsampling: "4:4:4", effort: 6 }).toFile(out);
  } else {
    await resized.jpeg({ quality: 88, mozjpeg: true }).toFile(out);
  }
}

export async function manifestEntry(input: string, intrinsic: { width: number; height: number }): Promise<ManifestEntry> {
  const widths = outputWidths(intrinsic.width);
  const largest = Math.max(...widths);
  const { dominant } = await sharp(input).stats();
  return {
    width: largest,
    height: Math.round((intrinsic.height * largest) / intrinsic.width),
    widths,
    color: toHex(dominant),
  };
}

/** The file names one photograph's images are cached under: `<width>.<ext>`. */
export function derivedFiles(entry: Pick<ManifestEntry, "widths">): string[] {
  return (["avif", "jpg"] as const).flatMap((ext) => widthsFor(entry.widths, ext).map((width) => `${width}.${ext}`));
}

export type Encoded = { entry: ManifestEntry; files: string[] };

/** Makes every image of one original into `outDir`, named as `derivedFiles` names them. */
export async function encodeOriginal(source: string, outDir: string, tmpDir: string): Promise<Encoded> {
  const input = await readable(source, tmpDir);
  const intrinsic = await measure(input);
  if (!intrinsic) throw new Error("cannot read the photograph's dimensions");
  const entry = await manifestEntry(input, intrinsic);
  const files = derivedFiles(entry);
  for (const name of files) {
    const [width, ext] = name.split(".") as [string, ImageExt];
    await encodeVariant(input, Number(width), ext, path.join(outDir, name));
  }
  return { entry, files };
}

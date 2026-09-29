import { widthsFor } from "../../src/data/photo-url";
import type { Manifest } from "../../src/data/schema";

export const TARGET_WIDTHS = [640, 1280, 2000, 2880, 4000] as const;
export const MAX_WIDTH = Math.max(...TARGET_WIDTHS);

export function outputWidths(intrinsicWidth: number): number[] {
  const fitting = TARGET_WIDTHS.filter((width) => width <= intrinsicWidth);
  const widths = new Set<number>(fitting);
  if (intrinsicWidth < MAX_WIDTH) {
    widths.add(intrinsicWidth);
  }
  return [...widths].sort((a, b) => a - b);
}

export function outputFile(
  setSlug: string,
  photoSlug: string,
  width: number,
  ext: "avif" | "jpg",
): string {
  return `public/photos/${setSlug}/${photoSlug}-${width}.${ext}`;
}

export function isStale(sourceMtimeMs: number, outputMtimeMs: number | null): boolean {
  return outputMtimeMs === null || sourceMtimeMs > outputMtimeMs;
}

export function toHex(rgb: { r: number; g: number; b: number }): string {
  const part = (value: number) => Math.round(value).toString(16).padStart(2, "0");
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}

/** Every derivative file the manifest accounts for, as repository-relative paths. */
export function expectedFiles(manifest: Manifest): Set<string> {
  const files = new Set<string>();
  for (const [key, entry] of Object.entries(manifest)) {
    const [setSlug, photoSlug] = key.split("/");
    if (!setSlug || !photoSlug) throw new Error(`manifest key "${key}" is not "<set>/<photo>"`);
    for (const ext of ["avif", "jpg"] as const) {
      for (const width of widthsFor(entry.widths, ext)) {
        files.add(outputFile(setSlug, photoSlug, width, ext));
      }
    }
  }
  return files;
}

/** The original's file name; the photo script cannot run without it. */
export function requireSource(photo: { slug: string; source?: string }, file: string): string {
  if (!photo.source) throw new Error(`${file}: photo "${photo.slug}": source must not be empty`);
  return photo.source;
}

/**
 * Guards against writing an empty manifest: an empty content folder, or
 * content files that yield zero photographs, must never overwrite the
 * manifest with `{}` (which would in turn prune every generated image).
 */
export function assertManifestNotEmpty(manifest: Manifest, contentDir: string): void {
  if (Object.keys(manifest).length === 0) {
    throw new Error(
      `no photographs found: looked for set content files (*.json) under "${contentDir}" and found none, ` +
        "or they listed no photographs; refusing to write an empty manifest",
    );
  }
}

import {
  parseManifest,
  parseSetContent,
  type ManifestEntry,
  type PhotoContent,
  type SetContent,
} from "./schema";

/** A photograph as the site uses it: the original's file name (`source`) is left out. */
export type Photo = Omit<PhotoContent, "source"> & ManifestEntry & { setSlug: string; index: number };
export type PhotoSet = Omit<SetContent, "photos"> & { photos: Photo[] };
export type Catalog = { sets: PhotoSet[] };
export type RawSet = { file: string; raw: unknown };

export function buildCatalog(input: {
  sets: RawSet[];
  manifest: unknown;
  order: readonly string[];
}): Catalog {
  const manifest = parseManifest(input.manifest);
  const bySlug = new Map<string, PhotoSet>();

  for (const { file, raw } of input.sets) {
    const content = parseSetContent(raw, file);
    if (!input.order.includes(content.slug)) {
      throw new Error(`${file}: set "${content.slug}" is not listed in SITE.setOrder`);
    }
    const seen = new Set<string>();
    const photos = content.photos.map((photo, index): Photo => {
      if (seen.has(photo.slug)) {
        throw new Error(`${file}: duplicate photo slug "${photo.slug}"`);
      }
      seen.add(photo.slug);
      const key = `${content.slug}/${photo.slug}`;
      const entry = manifest[key];
      if (!entry) {
        throw new Error(
          `${file}: photo "${photo.slug}" has no entry "${key}" in manifest.json; publish from the library, or run \`npm run library:pull\``,
        );
      }
      const { source: _source, ...shown } = photo;
      return { ...shown, ...entry, setSlug: content.slug, index };
    });
    bySlug.set(content.slug, { ...content, photos });
  }

  const sets = input.order.map((slug) => {
    const found = bySlug.get(slug);
    if (!found) throw new Error(`set "${slug}" is in SITE.setOrder but has no content file`);
    return found;
  });

  return { sets };
}

import { createHash } from "node:crypto";
import type { Manifest, ManifestEntry, SetContent } from "../../src/data/schema";
import { derivedFiles } from "../lib/encode";
import { outputFile } from "../lib/photo-plan";

/** One file under the originals folder; `relativePath` is `<folder>/<file name>`. */
export type OriginalFile = { relativePath: string; hash: string; width: number; height: number; contentType: string };

export type PlannedCategory = { id: string; slug: string; title: string; place: string; description: string; position: number };

export type PlannedPhoto = {
  id: string;
  categoryId: string;
  slug: string | null;
  title: string;
  alt: string;
  description: string;
  textStatus: "approved" | "needs_text";
  selected: 0 | 1;
  position: number;
  originalKey: string;
  previewKey: string;
  originalName: string;
  contentType: string;
  contentHash: string;
  width: number;
  height: number;
  relativePath: string;
};

export type MigrationPlan = {
  categories: PlannedCategory[];
  photos: PlannedPhoto[];
  /** Existing generated images to copy into the cache: bucket key, and the repository file it comes from. */
  derived: { key: string; from: string }[];
  metas: { key: string; entry: ManifestEntry }[];
  duplicates: { relativePath: string; sameAs: string }[];
};

/**
 * The library shows at most this many photographs in a category. A set that
 * shows more on the site today keeps its first eight shown, in order; the
 * rest come in with their text, ready to be ticked, but not shown.
 */
export const MAX_SHOWN = 8;

/** The first 32 characters of a hash, shaped like the UUIDs the library uses for ids. */
export function idFromHash(hash: string): string {
  const h = hash.slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const folderOf = (relativePath: string) => relativePath.split("/")[0]!;
const nameOf = (relativePath: string) => relativePath.split("/").pop()!;

/**
 * Works out everything the migration will write, without writing anything.
 * Ids are made from hashes, so planning twice gives the same plan and a run
 * that stopped halfway can simply be run again.
 */
export function planMigration(input: { originals: OriginalFile[]; sets: SetContent[]; order: string[]; manifest: Manifest }): MigrationPlan {
  const { originals, sets, order, manifest } = input;

  const categories: PlannedCategory[] = [];
  const folderToCategory = new Map<string, string>();
  for (const set of sets) {
    const position = order.indexOf(set.slug) + 1;
    if (position === 0) throw new Error(`the set "${set.slug}" is not in the order`);
    const id = idFromHash(sha256(`category:${set.slug}`));
    categories.push({ id, slug: set.slug, title: set.title, place: set.place, description: set.description, position });
    for (const photo of set.photos) {
      if (!photo.source) throw new Error(`${set.slug}/${photo.slug}: no original is recorded for it`);
      const folder = folderOf(photo.source);
      const owner = folderToCategory.get(folder);
      if (owner !== undefined && owner !== id) throw new Error(`the folder "${folder}" is used by more than one category`);
      folderToCategory.set(folder, id);
    }
  }
  categories.sort((a, b) => a.position - b.position);

  const byPath = new Map(originals.map((file) => [file.relativePath, file]));
  const photos: PlannedPhoto[] = [];
  const derived: MigrationPlan["derived"] = [];
  const metas: MigrationPlan["metas"] = [];
  const keptPathByHash = new Map<string, string>();

  const add = (file: OriginalFile, categoryId: string, text: Pick<PlannedPhoto, "slug" | "title" | "alt" | "description" | "textStatus" | "selected" | "position">) => {
    const id = idFromHash(file.hash);
    keptPathByHash.set(file.hash, file.relativePath);
    photos.push({
      id,
      categoryId,
      ...text,
      originalKey: `originals/${id}`,
      previewKey: `previews/${id}.jpg`,
      originalName: nameOf(file.relativePath),
      contentType: file.contentType,
      contentHash: file.hash,
      width: file.width,
      height: file.height,
      relativePath: file.relativePath,
    });
  };

  // Published photographs first, so that of two identical files the one the
  // site already uses is the one kept.
  for (const set of sets) {
    const categoryId = categories.find((category) => category.slug === set.slug)!.id;
    set.photos.forEach((photo, index) => {
      const address = `${set.slug}/${photo.slug}`;
      const file = byPath.get(photo.source!);
      if (!file) throw new Error(`${address}: its original "${photo.source}" was not found`);
      if (keptPathByHash.has(file.hash)) throw new Error(`${address}: its original is identical to "${keptPathByHash.get(file.hash)}"`);
      const entry = manifest[address];
      if (!entry) throw new Error(`${address}: no entry in the manifest`);
      const shown = index < MAX_SHOWN;
      add(file, categoryId, {
        slug: photo.slug,
        title: photo.title,
        alt: photo.alt,
        description: photo.description,
        textStatus: "approved",
        selected: shown ? 1 : 0,
        position: shown ? index + 1 : 0,
      });
      for (const name of derivedFiles(entry)) {
        const [width, ext] = name.split(".") as [string, "avif" | "jpg"];
        derived.push({ key: `derived/${file.hash}/${name}`, from: outputFile(set.slug, photo.slug, Number(width), ext) });
      }
      metas.push({ key: `derived/${file.hash}/meta.json`, entry });
    });
  }

  const duplicates: MigrationPlan["duplicates"] = [];
  const rest = originals
    .filter((file) => keptPathByHash.get(file.hash) !== file.relativePath)
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath, "en", { numeric: true }));
  for (const file of rest) {
    const sameAs = keptPathByHash.get(file.hash);
    if (sameAs) {
      duplicates.push({ relativePath: file.relativePath, sameAs });
      continue;
    }
    const categoryId = folderToCategory.get(folderOf(file.relativePath));
    if (!categoryId) throw new Error(`the folder "${folderOf(file.relativePath)}" does not belong to any category`);
    add(file, categoryId, { slug: null, title: "", alt: "", description: "", textStatus: "needs_text", selected: 0, position: 0 });
  }

  return { categories, photos, derived, metas, duplicates };
}

const q = (value: string | number | null): string => {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
};

/**
 * The inserts for the library's database, one statement per line. They skip
 * a row that is already there (ids come from hashes), so a run that stopped
 * after a partial import can be run again to finish it.
 */
export function toSql(plan: MigrationPlan, now: Date): string {
  const at = now.toISOString();
  const lines: string[] = [];
  for (const category of plan.categories) {
    lines.push(
      `INSERT OR IGNORE INTO categories (id, slug, title, place, description, position, hidden, created_at, updated_at) VALUES (${[
        q(category.id), q(category.slug), q(category.title), q(category.place), q(category.description), q(category.position), 0, q(at), q(at),
      ].join(", ")});`,
    );
  }
  plan.photos.forEach((photo, index) => {
    // A second apart each, so photographs that are not shown keep a steady
    // order in the admin (it lists those by when they were added).
    const created = new Date(now.getTime() + index * 1000).toISOString();
    lines.push(
      `INSERT OR IGNORE INTO photos (id, category_id, slug, title, alt, description, text_status, selected, position, original_key, preview_key, original_name, content_type, content_hash, width, height, source, created_at, updated_at) VALUES (${[
        q(photo.id), q(photo.categoryId), q(photo.slug), q(photo.title), q(photo.alt), q(photo.description), q(photo.textStatus),
        photo.selected, photo.position, q(photo.originalKey), q(photo.previewKey), q(photo.originalName), q(photo.contentType),
        q(photo.contentHash), photo.width, photo.height, q("migration"), q(created), q(created),
      ].join(", ")});`,
    );
  });
  return `${lines.join("\n")}\n`;
}

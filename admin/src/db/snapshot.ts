export type SnapshotPhoto = {
  slug: string;
  title: string;
  alt: string;
  description: string;
  contentHash: string;
  contentType: string;
  /** The original's file name. Never published; the site's build uses it to check that it never leaks. */
  originalName: string;
};

export type SnapshotCategory = {
  slug: string;
  title: string;
  place: string;
  description: string;
  photos: SnapshotPhoto[];
};

/** Exactly what one publish puts on the site: live categories, shown photographs, their order and text. */
export type Snapshot = { version: 1; categories: SnapshotCategory[] };

type Row = {
  category_slug: string;
  category_title: string;
  place: string;
  category_description: string;
  slug: string | null;
  title: string;
  alt: string;
  description: string;
  text_status: string;
  content_hash: string;
  content_type: string;
  original_name: string;
};

/**
 * The snapshot of the library as it stands, and every reason it cannot be
 * published. A photograph with a problem is left out of the snapshot, so the
 * snapshot is always well formed; a caller publishes only when `problems` is
 * empty.
 */
export async function buildSnapshot(db: D1Database): Promise<{ snapshot: Snapshot; problems: string[] }> {
  const { results } = await db
    .prepare(
      `SELECT c.slug AS category_slug, c.title AS category_title, c.place, c.description AS category_description,
              p.slug, p.title, p.alt, p.description, p.text_status, p.content_hash, p.content_type, p.original_name
       FROM categories c
       JOIN photos p ON p.category_id = c.id
       WHERE c.hidden = 0 AND p.selected = 1
       ORDER BY c.position, c.created_at, c.id, p.position, p.created_at, p.id`,
    )
    .all<Row>();

  const categories: SnapshotCategory[] = [];
  const problems: string[] = [];

  for (const row of results) {
    let category = categories.at(-1);
    if (!category || category.slug !== row.category_slug) {
      category = {
        slug: row.category_slug,
        title: row.category_title,
        place: row.place,
        description: row.category_description,
        photos: [],
      };
      categories.push(category);
    }
    const name = row.title.trim() || "An untitled photograph";
    const complete = row.slug && row.title.trim() && row.alt.trim() && row.description.trim();
    if (row.text_status !== "approved" || !complete) {
      problems.push(`${name} in ${row.category_title} has no approved text.`);
      continue;
    }
    if (category.photos.some((photo) => photo.slug === row.slug)) {
      problems.push(`Two photographs in ${row.category_title} share the address "${row.slug}".`);
      continue;
    }
    category.photos.push({
      slug: row.slug!,
      title: row.title,
      alt: row.alt,
      description: row.description,
      contentHash: row.content_hash,
      contentType: row.content_type,
      originalName: row.original_name,
    });
  }

  const live = categories.filter((category) => category.photos.length > 0);
  if (live.length === 0 && problems.length === 0) {
    problems.push("Nothing is shown in any category, so there is nothing to publish.");
  }
  return { snapshot: { version: 1, categories: live }, problems };
}

/** Snapshots are always built the same way, so equal text means an equal site. */
export function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function summarize(snapshot: Snapshot): { categories: number; photographs: number } {
  return {
    categories: snapshot.categories.length,
    photographs: snapshot.categories.reduce((total, category) => total + category.photos.length, 0),
  };
}

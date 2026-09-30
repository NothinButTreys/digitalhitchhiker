export type CategoryOut = {
  id: string;
  slug: string;
  title: string;
  place: string;
  description: string;
  position: number;
  hidden: boolean;
  photoCount: number;
  selectedCount: number;
  live: boolean;
  /** Preview of the first shown photograph, else the newest one; null when empty. */
  coverUrl: string | null;
};

type Row = {
  id: string;
  slug: string;
  title: string;
  place: string;
  description: string;
  position: number;
  hidden: number;
  photo_count: number;
  selected_count: number;
  cover_id: string | null;
};

const SELECT = `
  SELECT c.id, c.slug, c.title, c.place, c.description, c.position, c.hidden,
         COUNT(p.id) AS photo_count,
         COALESCE(SUM(p.selected), 0) AS selected_count,
         (SELECT cover.id FROM photos cover
           WHERE cover.category_id = c.id
           ORDER BY cover.selected DESC,
                    CASE WHEN cover.selected = 1 THEN cover.position END ASC,
                    cover.created_at DESC,
                    cover.id
           LIMIT 1) AS cover_id
  FROM categories c
  LEFT JOIN photos p ON p.category_id = c.id`;

function out(row: Row): CategoryOut {
  const hidden = row.hidden === 1;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    place: row.place,
    description: row.description,
    position: row.position,
    hidden,
    photoCount: row.photo_count,
    selectedCount: row.selected_count,
    live: !hidden && row.selected_count > 0,
    coverUrl: row.cover_id ? `/api/photos/${row.cover_id}/preview` : null,
  };
}

export async function listCategories(db: D1Database): Promise<CategoryOut[]> {
  const { results } = await db.prepare(`${SELECT} GROUP BY c.id ORDER BY c.position, c.created_at`).all<Row>();
  return results.map(out);
}

export async function getCategory(db: D1Database, id: string): Promise<CategoryOut | null> {
  const row = await db.prepare(`${SELECT} WHERE c.id = ? GROUP BY c.id`).bind(id).first<Row>();
  return row ? out(row) : null;
}

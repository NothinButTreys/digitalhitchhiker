export type PhotoOut = {
  id: string;
  categoryId: string;
  slug: string | null;
  title: string;
  alt: string;
  description: string;
  textStatus: "needs_text" | "approved";
  selected: boolean;
  position: number;
  originalName: string;
  width: number;
  height: number;
  source: "upload" | "migration" | "google-photos";
  createdAt: string;
  previewUrl: string;
};

export type PhotoRow = {
  id: string;
  category_id: string;
  slug: string | null;
  title: string;
  alt: string;
  description: string;
  text_status: PhotoOut["textStatus"];
  selected: number;
  position: number;
  original_key: string;
  preview_key: string;
  original_name: string;
  content_type: string;
  content_hash: string;
  width: number;
  height: number;
  source: PhotoOut["source"];
  created_at: string;
  updated_at: string;
};

export function photoOut(row: PhotoRow): PhotoOut {
  return {
    id: row.id,
    categoryId: row.category_id,
    slug: row.slug,
    title: row.title,
    alt: row.alt,
    description: row.description,
    textStatus: row.text_status,
    selected: row.selected === 1,
    position: row.position,
    originalName: row.original_name,
    width: row.width,
    height: row.height,
    source: row.source,
    createdAt: row.created_at,
    previewUrl: `/api/photos/${row.id}/preview`,
  };
}

export async function getPhotoRow(db: D1Database, id: string): Promise<PhotoRow | null> {
  return db.prepare("SELECT * FROM photos WHERE id = ?").bind(id).first<PhotoRow>();
}

export async function getPhoto(db: D1Database, id: string): Promise<PhotoOut | null> {
  const row = await getPhotoRow(db, id);
  return row ? photoOut(row) : null;
}

export async function listPhotos(db: D1Database, categoryId: string): Promise<PhotoOut[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM photos WHERE category_id = ?
       ORDER BY selected DESC,
                CASE WHEN selected = 1 THEN position END ASC,
                created_at DESC`,
    )
    .bind(categoryId)
    .all<PhotoRow>();
  return results.map(photoOut);
}

export async function selectedIds(db: D1Database, categoryId: string): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT id FROM photos WHERE category_id = ? AND selected = 1 ORDER BY position, created_at")
    .bind(categoryId)
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

/**
 * Prepared statements that renumber the given photographs to consecutive positions
 * starting at 1, in the given order. Returned rather than run so a caller can fold
 * them into a larger `db.batch` alongside a select/deselect/move/delete write, which
 * is what keeps that write and the renumbering atomic together.
 *
 * Each statement only touches a photograph that is still selected when it runs:
 * the list was read before the batch, and a photograph deselected in between by
 * another request must keep position 0, never be given a place in the order.
 */
export function renumberStatements(db: D1Database, ids: string[]): D1PreparedStatement[] {
  const now = new Date().toISOString();
  return ids.map((id, index) =>
    db.prepare("UPDATE photos SET position = ?, updated_at = ? WHERE id = ? AND selected = 1").bind(index + 1, now, id),
  );
}

/**
 * Renumbers a category's selected photographs on their own (used by the selection-order
 * route, which has no other write to fold this into). Batched with `db.batch`: D1 applies
 * the statements in one batch atomically (all-or-nothing), so an interruption leaves either
 * the old numbering or the fully-renumbered new one — never a partially renumbered category
 * with duplicate or gapped positions.
 */
export async function renumberSelection(db: D1Database, categoryId: string, order?: string[]): Promise<void> {
  const ids = order ?? (await selectedIds(db, categoryId));
  if (ids.length === 0) return;
  await db.batch(renumberStatements(db, ids));
}

export async function slugsInCategory(db: D1Database, categoryId: string, exceptId?: string): Promise<Set<string>> {
  const { results } = await db
    .prepare("SELECT slug FROM photos WHERE category_id = ? AND slug IS NOT NULL AND id != ?")
    .bind(categoryId, exceptId ?? "")
    .all<{ slug: string }>();
  return new Set(results.map((row) => row.slug));
}

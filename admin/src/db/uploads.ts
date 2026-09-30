export type UploadRow = {
  id: string;
  category_id: string;
  original_name: string;
  content_type: string;
  content_hash: string;
  size: number;
  width: number;
  height: number;
  has_original: number;
  has_preview: number;
  created_at: string;
};

export const originalKey = (id: string) => `originals/${id}`;
export const previewKey = (id: string) => `previews/${id}.jpg`;

export async function getUpload(db: D1Database, id: string): Promise<UploadRow | null> {
  return db.prepare("SELECT * FROM uploads WHERE id = ?").bind(id).first<UploadRow>();
}

/**
 * Removes a pending upload: its row first, then its files — and the files only
 * when this call's row delete is the one that removed the row. Whoever removes
 * the row owns the files. If the row was already gone (another remover got
 * there first, or `complete` turned it into a photograph whose files now live
 * at these same keys), this deletes nothing and answers `false`.
 */
export async function removeUpload(db: D1Database, bucket: R2Bucket, id: string): Promise<boolean> {
  const { meta } = await db.prepare("DELETE FROM uploads WHERE id = ?").bind(id).run();
  if (meta.changes !== 1) return false;
  await bucket.delete([originalKey(id), previewKey(id)]);
  return true;
}

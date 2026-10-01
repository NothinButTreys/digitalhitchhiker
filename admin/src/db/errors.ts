// D1 does not expose a typed constraint-violation error: it throws a plain
// Error whose message names the failing constraint, for example
//   D1_ERROR: UNIQUE constraint failed: categories.slug: SQLITE_CONSTRAINT (…)
// SQLite names a UNIQUE column, or an index over plain columns, by its
// columns ("photos.category_id, photos.slug"), and an index over expressions
// as "index '<name>'". The target must match exactly, so a NOT NULL, FOREIGN
// KEY, or other constraint, or a UNIQUE violation elsewhere, is never
// mistaken for this one.
const UNIQUE_FAILED = /UNIQUE constraint failed: ([^:]+?)(?::|$)/;

export function isUniqueViolation(error: unknown, target: string): boolean {
  if (!(error instanceof Error)) return false;
  const named = UNIQUE_FAILED.exec(error.message)?.[1]?.trim();
  return named === target || named === `index '${target}'`;
}

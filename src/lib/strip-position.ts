/**
 * Where the visitor left a set's strip, kept for this tab only.
 *
 * One place is kept at a time, and only for as long as the visitor stays in
 * that set: opening one of its photographs and coming back returns to the
 * same frame, while going to another set (or any other page) and returning
 * starts the set again from its first photograph.
 */
const KEY = "dh:strip";

type Saved = { slug: string; position: number };

function read(): Saved | null {
  try {
    const saved: unknown = JSON.parse(window.sessionStorage.getItem(KEY) ?? "null");
    if (typeof saved !== "object" || saved === null) return null;
    const { slug, position } = saved as Record<string, unknown>;
    if (typeof slug !== "string" || typeof position !== "number" || !Number.isFinite(position)) return null;
    return { slug, position };
  } catch {
    // Storage is unavailable or holds something unreadable.
    return null;
  }
}

/** The scroll position to return this set's strip to, or null to start at its first photograph. */
export function recallPosition(slug: string): number | null {
  const saved = read();
  return saved && saved.slug === slug && saved.position > 0 ? saved.position : null;
}

export function rememberPosition(slug: string, position: number): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ slug, position: Math.round(position) }));
  } catch {
    // Storage is unavailable; the strip will start at the beginning next time.
  }
}

/** Forgets the kept place unless it belongs to `slug`, the set the visitor is in now (null: no set). */
export function forgetPositionUnless(slug: string | null): void {
  try {
    const saved = read();
    if (saved && saved.slug !== slug) window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing was kept, so there is nothing to forget.
  }
}

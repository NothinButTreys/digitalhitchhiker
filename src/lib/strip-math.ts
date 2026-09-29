/**
 * The frame whose leading edge is nearest the scroll position. A frame that
 * starts beyond `maxScroll` can never reach the leading edge, so it is compared
 * as if it started at `maxScroll`; at the end of the strip, ties go to the
 * later frame so the last photograph can be reached.
 */
export function nearestIndex(offsets: number[], position: number, maxScroll: number): number {
  if (maxScroll <= 0) return 0;
  const atEnd = position >= maxScroll - 1;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  offsets.forEach((offset, index) => {
    const distance = Math.abs(Math.min(offset, maxScroll) - position);
    if (distance < bestDistance || (atEnd && distance === bestDistance)) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

export function formatCounter(index: number, total: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(index + 1)} / ${pad(total)}`;
}

export function clampIndex(index: number, total: number): number {
  return Math.min(Math.max(index, 0), Math.max(total - 1, 0));
}

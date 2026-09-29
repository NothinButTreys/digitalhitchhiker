export type ImageExt = "avif" | "jpg";
export const JPEG_MAX_WIDTH = 2000;
type Addressable = { setSlug: string; slug: string; widths: number[] };

export function widthsFor(widths: number[], ext: ImageExt): number[] {
  return ext === "avif" ? widths : widths.filter((width) => width <= JPEG_MAX_WIDTH);
}

export function photoUrl(photo: Addressable, width: number, ext: ImageExt): string {
  return `/photos/${photo.setSlug}/${photo.slug}-${width}.${ext}`;
}

export function srcSet(photo: Addressable, ext: ImageExt): string {
  return widthsFor(photo.widths, ext)
    .map((width) => `${photoUrl(photo, width, ext)} ${width}w`)
    .join(", ");
}

export function largestUpTo(photo: Addressable, max: number): number {
  const fitting = photo.widths.filter((width) => width <= max);
  return fitting.length > 0 ? Math.max(...fitting) : Math.min(...photo.widths);
}

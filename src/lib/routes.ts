import type { Catalog, Photo, PhotoSet } from "../data/catalog";

export type Resolved =
  | { kind: "set"; set: PhotoSet; isHome: boolean }
  | { kind: "photo"; set: PhotoSet; photo: Photo }
  | { kind: "colophon" }
  | { kind: "notFound" };

export const COLOPHON_PATH = "/colophon";

export function setPath(set: { slug: string }): string {
  return `/${set.slug}`;
}

export function photoPath(photo: { setSlug: string; slug: string }): string {
  return `/${photo.setSlug}/${photo.slug}`;
}

export function resolve(catalog: Catalog, pathname: string): Resolved {
  const parts = pathname.split("/").filter(Boolean);
  const first = catalog.sets[0];

  if (parts.length === 0) {
    return first ? { kind: "set", set: first, isHome: true } : { kind: "notFound" };
  }
  if (parts.length === 1 && parts[0] === "colophon") return { kind: "colophon" };

  const set = catalog.sets.find((candidate) => candidate.slug === parts[0]);
  if (!set) return { kind: "notFound" };
  if (parts.length === 1) return { kind: "set", set, isHome: false };

  const photo = set.photos.find((candidate) => candidate.slug === parts[1]);
  if (!photo || parts.length > 2) return { kind: "notFound" };
  return { kind: "photo", set, photo };
}

export function nextSet(catalog: Catalog, slug: string): PhotoSet {
  const index = catalog.sets.findIndex((set) => set.slug === slug);
  const next = catalog.sets[(index + 1) % catalog.sets.length];
  if (index === -1 || !next) throw new Error(`unknown set "${slug}"`);
  return next;
}

export function allPaths(catalog: Catalog): string[] {
  return [
    "/",
    ...catalog.sets.flatMap((set) => [setPath(set), ...set.photos.map(photoPath)]),
    COLOPHON_PATH,
  ];
}

import type { Photo } from "../data/catalog";
import { JPEG_MAX_WIDTH, largestUpTo, photoUrl } from "../data/photo-url";
import { SITE } from "../data/site";
import { COLOPHON_PATH, photoPath, setPath, type Resolved } from "./routes";

export type HeadData = {
  title: string;
  description: string;
  canonical: string | null;
  noindex: boolean;
  image: { url: string; width: number; height: number; alt: string } | null;
  jsonLd: Record<string, unknown> | null;
};

const absolute = (path: string) => `${SITE.origin}${path}`;

function preview(photo: Photo): NonNullable<HeadData["image"]> {
  const width = largestUpTo(photo, 1280);
  return {
    url: absolute(photoUrl(photo, width, "jpg")),
    width,
    height: Math.round((photo.height * width) / photo.width),
    alt: photo.alt,
  };
}

export function headFor(resolved: Resolved): HeadData {
  switch (resolved.kind) {
    case "set": {
      const cover = resolved.set.photos[0];
      return {
        title: resolved.isHome
          ? `${SITE.name} — Photographs`
          : `${resolved.set.title} — ${SITE.name}`,
        description: resolved.isHome ? SITE.description : resolved.set.description,
        canonical: absolute(setPath(resolved.set)),
        noindex: false,
        image: cover ? preview(cover) : null,
        jsonLd: null,
      };
    }
    case "photo": {
      const { photo, set } = resolved;
      const full = largestUpTo(photo, JPEG_MAX_WIDTH);
      return {
        title: `${photo.title} — ${set.title} — ${SITE.name}`,
        description: photo.description,
        canonical: absolute(photoPath(photo)),
        noindex: false,
        image: preview(photo),
        jsonLd: {
          "@context": "https://schema.org",
          "@type": "ImageObject",
          name: photo.title,
          description: photo.description,
          contentUrl: absolute(photoUrl(photo, full, "jpg")),
          width: full,
          height: Math.round((photo.height * full) / photo.width),
          creator: { "@type": "Organization", name: SITE.name },
        },
      };
    }
    case "colophon":
      return {
        title: `Colophon — ${SITE.name}`,
        description: `About ${SITE.name} and how to get in touch.`,
        canonical: absolute(COLOPHON_PATH),
        noindex: false,
        image: null,
        jsonLd: null,
      };
    case "notFound":
      return {
        title: `Not found — ${SITE.name}`,
        description: "This page does not exist.",
        canonical: null,
        noindex: true,
        image: null,
        jsonLd: null,
      };
  }
}

function escape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderHead(head: HeadData): string {
  const tags = [
    `<title>${escape(head.title)}</title>`,
    `<meta name="description" content="${escape(head.description)}">`,
    `<meta property="og:site_name" content="${escape(SITE.name)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escape(head.title)}">`,
    `<meta property="og:description" content="${escape(head.description)}">`,
    `<meta name="twitter:card" content="${head.image ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${escape(head.title)}">`,
    `<meta name="twitter:description" content="${escape(head.description)}">`,
  ];
  if (head.canonical) {
    tags.push(`<link rel="canonical" href="${escape(head.canonical)}">`);
    tags.push(`<meta property="og:url" content="${escape(head.canonical)}">`);
  }
  if (head.noindex) tags.push(`<meta name="robots" content="noindex">`);
  if (head.image) {
    tags.push(`<meta property="og:image" content="${escape(head.image.url)}">`);
    tags.push(`<meta property="og:image:width" content="${head.image.width}">`);
    tags.push(`<meta property="og:image:height" content="${head.image.height}">`);
    tags.push(`<meta property="og:image:alt" content="${escape(head.image.alt)}">`);
    tags.push(`<meta name="twitter:image" content="${escape(head.image.url)}">`);
    tags.push(`<meta name="twitter:image:alt" content="${escape(head.image.alt)}">`);
  }
  if (head.jsonLd) {
    const json = JSON.stringify(head.jsonLd).replaceAll("<", "\\u003c");
    tags.push(`<script type="application/ld+json">${json}</script>`);
  }
  return tags.join("\n    ");
}

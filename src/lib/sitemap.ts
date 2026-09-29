import { SITE } from "../data/site";

export function sitemapXml(paths: string[]): string {
  const urls = paths
    .filter((path) => path !== "/")
    .map((path) => `  <url><loc>${SITE.origin}${path}</loc></url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

export function robotsTxt(): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE.origin}/sitemap.xml\n`;
}

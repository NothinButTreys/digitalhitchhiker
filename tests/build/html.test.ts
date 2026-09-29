import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function filesIn(dir: string, extensions: string[]): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return filesIn(full, extensions);
    return extensions.some((ext) => name.endsWith(ext)) ? [full] : [];
  });
}

const files = existsSync("dist") ? filesIn("dist", [".html"]) : [];
const sources = readdirSync("content/sets")
  .filter((name) => name.endsWith(".json"))
  .flatMap((name) => {
    const set = JSON.parse(readFileSync(path.join("content/sets", name), "utf8")) as {
      photos: { source: string }[];
    };
    return set.photos.map((photo) => photo.source);
  });
const content = JSON.parse(readFileSync("content/sets/phoenix-zoo.json", "utf8")) as {
  photos: { slug: string }[];
};

describe("prerendered site", () => {
  it("has a page for the root, a set, a photo, the colophon, and 404", () => {
    const firstPhoto = content.photos[0]?.slug;
    for (const file of [
      "dist/index.html",
      "dist/phoenix-zoo/index.html",
      `dist/phoenix-zoo/${firstPhoto}/index.html`,
      "dist/colophon/index.html",
      "dist/404.html",
    ]) {
      expect(existsSync(file), file).toBe(true);
    }
  });

  it("lists every prerendered route except the root and 404 in the sitemap, once each", () => {
    const routes = files
      .filter((file) => file !== path.join("dist", "index.html") && !file.endsWith("404.html"))
      .map((file) => `/${path.relative("dist", path.dirname(file)).split(path.sep).join("/")}`);
    const locs = [...readFileSync("dist/sitemap.xml", "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => match[1]!.replace("https://digitalhitchhiker.photography", ""),
    );
    expect(routes.length).toBeGreaterThan(5);
    expect([...locs].sort()).toEqual([...routes].sort());
    expect(readFileSync("dist/robots.txt", "utf8")).toContain("Allow: /");
  });

  it.each(files)("%s only points at image files that exist", (file) => {
    const html = readFileSync(file, "utf8");
    // React writes the attribute as `srcSet`; HTML attribute names ignore case.
    const urls = [...html.matchAll(/\s(?:srcset|src)="([^"]*)"/gi)].flatMap((match) =>
      match[1]!.split(",").map((candidate) => candidate.trim().split(/\s+/)[0] ?? ""),
    );
    const photos = urls.filter((url) => url.startsWith("/photos/"));
    if (!file.endsWith("404.html") && !file.endsWith(path.join("colophon", "index.html"))) {
      expect(photos.length).toBeGreaterThan(0);
    }
    expect(photos.filter((url) => !existsSync(path.join("dist", url)))).toEqual([]);
  });

  it("writes a sitemap and robots file", () => {
    expect(readFileSync("dist/sitemap.xml", "utf8")).toContain(
      "<loc>https://digitalhitchhiker.photography/phoenix-zoo</loc>",
    );
    expect(readFileSync("dist/robots.txt", "utf8")).toContain("Sitemap: ");
  });

  it("never ships an original's file name in a script or page", () => {
    const shipped = filesIn("dist", [".js", ".html"]);
    expect(shipped.length).toBeGreaterThan(files.length);
    expect(sources.length).toBeGreaterThan(0);
    const leaks = shipped.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return sources
        .filter((source) => text.includes(source) || text.includes(path.basename(source)))
        .map((source) => `${file}: ${source}`);
    });
    expect(leaks).toEqual([]);
  });

  it.each(files)("%s has a title, description, and rendered content", (file) => {
    const html = readFileSync(file, "utf8");
    expect(html).toMatch(/<title>[^<]+<\/title>/);
    expect(html).toMatch(/<meta name="description" content="[^"]+">/);
    expect(html).not.toContain("<!--head-->");
    expect(html).not.toContain("<!--app-->");
    expect(html).toMatch(/<h1[^>]*>[^<]+<\/h1>/);
  });

  it.each(files.filter((file) => !file.endsWith("404.html")))("%s has a canonical URL", (file) => {
    expect(readFileSync(file, "utf8")).toMatch(
      /<link rel="canonical" href="https:\/\/digitalhitchhiker\.photography\/[^"]*">/,
    );
  });

  it.each(files)("%s gives every image non-empty alt text", (file) => {
    const images = readFileSync(file, "utf8").match(/<img\b[^>]*>/g) ?? [];
    const withoutAlt = images.filter((tag) => !/\balt="[^"]+"/.test(tag));
    expect(withoutAlt).toEqual([]);
  });
});

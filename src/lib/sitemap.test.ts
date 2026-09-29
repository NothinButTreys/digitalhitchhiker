import { describe, expect, it } from "vitest";
import { robotsTxt, sitemapXml } from "./sitemap";

describe("sitemapXml", () => {
  it("lists canonical URLs and leaves out the root duplicate", () => {
    expect(sitemapXml(["/", "/city", "/city/three"])).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        "  <url><loc>https://digitalhitchhiker.photography/city</loc></url>",
        "  <url><loc>https://digitalhitchhiker.photography/city/three</loc></url>",
        "</urlset>",
        "",
      ].join("\n"),
    );
  });
});

describe("robotsTxt", () => {
  it("allows everything and points at the sitemap", () => {
    expect(robotsTxt()).toBe(
      "User-agent: *\nAllow: /\n\nSitemap: https://digitalhitchhiker.photography/sitemap.xml\n",
    );
  });
});

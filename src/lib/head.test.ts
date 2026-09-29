import { describe, expect, it } from "vitest";
import { headFor, renderHead } from "./head";
import { resolve } from "./routes";
import { fixture } from "./fixture";

describe("headFor", () => {
  it("describes a set", () => {
    expect(headFor(resolve(fixture, "/city"))).toEqual({
      title: "City — Digital Hitchhiker",
      description: "City set.",
      canonical: "https://digitalhitchhiker.photography/city",
      noindex: false,
      image: {
        url: "https://digitalhitchhiker.photography/photos/city/three-1280.jpg",
        width: 1280,
        height: 853,
        alt: "three",
      },
      jsonLd: null,
    });
  });

  it("points the home canonical at the first set", () => {
    const head = headFor(resolve(fixture, "/"));
    expect(head.title).toBe("Digital Hitchhiker — Photographs");
    expect(head.canonical).toBe("https://digitalhitchhiker.photography/desert");
  });

  it("describes a photo with ImageObject data", () => {
    const head = headFor(resolve(fixture, "/desert/two"));
    expect(head.title).toBe("two — Desert — Digital Hitchhiker");
    expect(head.canonical).toBe("https://digitalhitchhiker.photography/desert/two");
    expect(head.jsonLd).toEqual({
      "@context": "https://schema.org",
      "@type": "ImageObject",
      name: "two",
      description: "two",
      contentUrl: "https://digitalhitchhiker.photography/photos/desert/two-2000.jpg",
      width: 2000,
      height: 1333,
      creator: { "@type": "Organization", name: "Digital Hitchhiker" },
    });
  });

  it("describes the colophon", () => {
    expect(headFor(resolve(fixture, "/colophon"))).toMatchObject({
      title: "Colophon — Digital Hitchhiker",
      canonical: "https://digitalhitchhiker.photography/colophon",
      image: null,
    });
  });

  it("marks not-found pages noindex with no canonical", () => {
    expect(headFor(resolve(fixture, "/nope"))).toMatchObject({
      title: "Not found — Digital Hitchhiker",
      canonical: null,
      noindex: true,
    });
  });
});

describe("renderHead", () => {
  it("renders tags for a photo page", () => {
    const html = renderHead(headFor(resolve(fixture, "/desert/two")));
    expect(html).toContain("<title>two — Desert — Digital Hitchhiker</title>");
    expect(html).toContain('<meta name="description" content="two">');
    expect(html).toContain('<link rel="canonical" href="https://digitalhitchhiker.photography/desert/two">');
    expect(html).toContain('<meta property="og:image" content="https://digitalhitchhiker.photography/photos/desert/two-1280.jpg">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('<script type="application/ld+json">');
  });

  it("escapes text and keeps script-closing sequences out of JSON-LD", () => {
    const html = renderHead({
      title: 'A "quoted" <title>',
      description: "Tom & Jerry",
      canonical: null,
      noindex: true,
      image: null,
      jsonLd: { name: "</script>" },
    });
    expect(html).toContain("<title>A &quot;quoted&quot; &lt;title&gt;</title>");
    expect(html).toContain('content="Tom &amp; Jerry"');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain("</script>\"}");
    expect(html).toContain("\\u003c/script>");
    expect(html).not.toContain("rel=\"canonical\"");
  });
});

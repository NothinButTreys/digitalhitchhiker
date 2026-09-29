import { describe, expect, it } from "vitest";
import { largestUpTo, photoUrl, srcSet, widthsFor } from "./photo-url";

const photo = { setSlug: "phoenix-zoo", slug: "tiger", widths: [640, 1280, 2000, 2880, 4000] };

describe("widthsFor", () => {
  it("offers every width as AVIF", () => {
    expect(widthsFor(photo.widths, "avif")).toEqual([640, 1280, 2000, 2880, 4000]);
  });

  it("offers JPEG only up to 2000 wide", () => {
    expect(widthsFor(photo.widths, "jpg")).toEqual([640, 1280, 2000]);
  });

  it("keeps a single small width for both formats", () => {
    expect(widthsFor([500], "jpg")).toEqual([500]);
  });
});

describe("photo URLs", () => {
  it("builds a derivative URL", () => {
    expect(photoUrl(photo, 1280, "avif")).toBe("/photos/phoenix-zoo/tiger-1280.avif");
  });

  it("builds a JPEG srcset limited to the JPEG widths", () => {
    expect(srcSet(photo, "jpg")).toBe(
      "/photos/phoenix-zoo/tiger-640.jpg 640w, /photos/phoenix-zoo/tiger-1280.jpg 1280w, /photos/phoenix-zoo/tiger-2000.jpg 2000w",
    );
  });

  it("builds an AVIF srcset up to full size", () => {
    expect(srcSet(photo, "avif")).toContain("/photos/phoenix-zoo/tiger-4000.avif 4000w");
  });

  it("picks the largest width not above the limit", () => {
    expect(largestUpTo(photo, 1280)).toBe(1280);
    expect(largestUpTo(photo, 1500)).toBe(1280);
  });

  it("falls back to the smallest width when all exceed the limit", () => {
    expect(largestUpTo({ ...photo, widths: [900] }, 640)).toBe(900);
  });
});

import { describe, expect, it } from "vitest";
import {
  expectedFiles,
  isStale,
  outputFile,
  outputWidths,
  requireSource,
  toHex,
} from "./photo-plan";

describe("outputWidths", () => {
  it.each([
    [6000, [640, 1280, 2000, 2880, 4000]],
    [4000, [640, 1280, 2000, 2880, 4000]],
    [3888, [640, 1280, 2000, 2880, 3888]],
    [1500, [640, 1280, 1500]],
    [1280, [640, 1280]],
    [1080, [640, 1080]],
    [500, [500]],
  ])("outputWidths(%i) === %j", (intrinsicWidth, expected) => {
    expect(outputWidths(intrinsicWidth)).toEqual(expected);
  });
});

describe("outputFile", () => {
  it("places derivatives under public/photos", () => {
    expect(outputFile("phoenix-zoo", "tiger", 640, "avif")).toBe(
      "public/photos/phoenix-zoo/tiger-640.avif",
    );
  });
});

describe("isStale", () => {
  it("is stale when the output is missing", () => {
    expect(isStale(100, null)).toBe(true);
  });

  it("is stale when the source is newer", () => {
    expect(isStale(200, 100)).toBe(true);
  });

  it("is fresh when the output is newer", () => {
    expect(isStale(100, 200)).toBe(false);
  });
});

describe("toHex", () => {
  it("formats a colour as lowercase hex", () => {
    expect(toHex({ r: 11, g: 171, b: 255 })).toBe("#0babff");
  });
});

describe("expectedFiles", () => {
  it("lists every derivative the manifest implies, with JPEG only up to 2000px", () => {
    const manifest = {
      "phoenix-zoo/tiger": { width: 2880, height: 1920, widths: [640, 1280, 2000, 2880], color: "#112233" },
      "montreal/clock": { width: 1080, height: 1440, widths: [640, 1080], color: "#445566" },
    };
    expect([...expectedFiles(manifest)].sort()).toEqual(
      [
        "public/photos/montreal/clock-640.avif",
        "public/photos/montreal/clock-640.jpg",
        "public/photos/montreal/clock-1080.avif",
        "public/photos/montreal/clock-1080.jpg",
        "public/photos/phoenix-zoo/tiger-640.avif",
        "public/photos/phoenix-zoo/tiger-640.jpg",
        "public/photos/phoenix-zoo/tiger-1280.avif",
        "public/photos/phoenix-zoo/tiger-1280.jpg",
        "public/photos/phoenix-zoo/tiger-2000.avif",
        "public/photos/phoenix-zoo/tiger-2000.jpg",
        "public/photos/phoenix-zoo/tiger-2880.avif",
      ].sort(),
    );
  });

  it("is empty for an empty manifest", () => {
    expect(expectedFiles({}).size).toBe(0);
  });
});

describe("requireSource", () => {
  it("returns the original's file name", () => {
    expect(requireSource({ slug: "tiger", source: "Phoenix Zoo/fam-10.JPG" }, "x.json")).toBe(
      "Phoenix Zoo/fam-10.JPG",
    );
  });

  it("names the file and photo when the source is missing", () => {
    expect(() => requireSource({ slug: "tiger" }, "content/sets/phoenix-zoo.json")).toThrow(
      'content/sets/phoenix-zoo.json: photo "tiger": source must not be empty',
    );
  });
});

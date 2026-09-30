import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { derivedFiles, encodeOriginal, measure } from "./encode";

let dir: string;
let source: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "dh-encode-"));
  source = path.join(dir, "original.jpg");
  // Stored 900 wide by 1400 tall with an orientation tag that turns it, so it
  // displays 1400 wide by 900 tall; it also carries a private EXIF field.
  await sharp({ create: { width: 900, height: 1400, channels: 3, background: "#336699" } })
    .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "Not for publication" } } })
    .jpeg()
    .toFile(source);
});

afterAll(() => rm(dir, { recursive: true, force: true }));

describe("derivedFiles", () => {
  it("names AVIF at every width and JPEG up to 2000", () => {
    expect(derivedFiles({ widths: [640, 1280, 2000, 2880, 4000] })).toEqual([
      "640.avif", "1280.avif", "2000.avif", "2880.avif", "4000.avif", "640.jpg", "1280.jpg", "2000.jpg",
    ]);
  });
});

describe("measure", () => {
  it("gives the size as displayed, after the orientation tag is applied", async () => {
    expect(await measure(source)).toEqual({ width: 1400, height: 900 });
  });
});

describe("encodeOriginal", () => {
  it("writes every width in both formats, turned upright, with private metadata removed", async () => {
    const outDir = path.join(dir, "out");
    await mkdir(outDir);
    const { entry, files } = await encodeOriginal(source, outDir, dir);

    // The colour is the dominant one as sharp bins it, so only its shape is checked.
    expect({ ...entry, color: "" }).toEqual({ width: 1400, height: 900, widths: [640, 1280, 1400], color: "" });
    expect(entry.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(files).toEqual(derivedFiles(entry));
    expect((await readdir(outDir)).sort()).toEqual([...files].sort());

    for (const name of files) {
      const meta = await sharp(path.join(outDir, name)).metadata();
      const width = Number(name.split(".")[0]);
      expect(meta.width, name).toBe(width);
      expect(meta.height, name).toBe(Math.round((900 * width) / 1400));
      expect(meta.format, name).toBe(name.endsWith(".avif") ? "heif" : "jpeg");
      expect(meta.exif, name).toBeUndefined();
      expect(meta.orientation, name).toBeUndefined();
    }
  }, 120_000);
});

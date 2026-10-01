import { describe, expect, it, vi } from "vitest";
import { prepareUpload, previewSize, sha256Hex, UnreadableImageError, type Decoder } from "./prepare-upload";

describe("previewSize", () => {
  it.each([
    [6000, 4000, 1600, 1067],
    [4000, 6000, 1067, 1600],
    [3888, 2592, 1600, 1067],
    [1600, 1600, 1600, 1600],
    [1080, 1080, 1080, 1080],
    [800, 600, 800, 600],
    [5000, 1, 1600, 1],
  ])("%d by %d becomes %d by %d", (width, height, w, h) => {
    expect(previewSize(width, height)).toEqual({ width: w, height: h });
  });
});

describe("sha256Hex", () => {
  it("hashes bytes as lowercase hex", async () => {
    const bytes = new TextEncoder().encode("abc").buffer as ArrayBuffer;
    expect(await sha256Hex(bytes)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

const decoder = (width: number, height: number): Decoder & { draw: ReturnType<typeof vi.fn> } => {
  const draw = vi.fn(async () => new Blob(["preview"], { type: "image/jpeg" }));
  return Object.assign(async () => ({ width, height, draw }), { draw });
};

describe("prepareUpload", () => {
  it("returns the type, hash, size, and a preview at the right size", async () => {
    const file = new File(["abc"], "river.jpg", { type: "image/jpeg" });
    const decode = decoder(6000, 4000);
    const prepared = await prepareUpload(file, decode);
    expect(prepared).toMatchObject({
      file,
      contentType: "image/jpeg",
      contentHash: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      width: 6000,
      height: 4000,
    });
    expect(prepared.preview.type).toBe("image/jpeg");
    expect(decode.draw).toHaveBeenCalledWith({ width: 1600, height: 1067 });
  });

  it.each([
    ["IMG_1.HEIC", "image/heic"],
    ["a.heif", "image/heif"],
    ["b.JPEG", "image/jpeg"],
    ["c.png", "image/png"],
  ])("takes the type of %s from its extension when the browser gives none", async (name, type) => {
    expect((await prepareUpload(new File(["x"], name, { type: "" }), decoder(10, 10))).contentType).toBe(type);
  });

  it("refuses other kinds of file", async () => {
    const failure = await prepareUpload(new File(["x"], "notes.pdf", { type: "application/pdf" }), decoder(1, 1)).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(UnreadableImageError);
    expect((failure as Error).message).toBe("notes.pdf is not a JPEG, PNG, or HEIC photograph.");
  });

  it("refuses a file over 60 MB without reading it", async () => {
    const file = new File(["x"], "huge.jpg", { type: "image/jpeg" });
    Object.defineProperty(file, "size", { value: 60 * 1024 * 1024 + 1 });
    const decode = vi.fn();
    const failure = await prepareUpload(file, decode as unknown as Decoder).catch((e: unknown) => e);
    expect((failure as Error).message).toBe("huge.jpg is larger than 60 MB.");
    expect(decode).not.toHaveBeenCalled();
  });

  it("re-encodes a preview over 2 MB once at quality 0.7", async () => {
    const large = new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: "image/jpeg" });
    const small = new Blob(["smaller preview"], { type: "image/jpeg" });
    const draw = vi.fn().mockResolvedValueOnce(large).mockResolvedValueOnce(small);
    const close = vi.fn();
    const decode: Decoder = async () => ({ width: 6000, height: 4000, draw, close });

    const prepared = await prepareUpload(new File(["abc"], "river.jpg", { type: "image/jpeg" }), decode);

    expect(prepared.preview).toBe(small);
    expect(draw.mock.calls).toEqual([[{ width: 1600, height: 1067 }], [{ width: 1600, height: 1067 }, 0.7]]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("keeps a preview of exactly 2 MB without re-encoding", async () => {
    const draw = vi.fn(async () => new Blob([new Uint8Array(2 * 1024 * 1024)], { type: "image/jpeg" }));
    const decode: Decoder = async () => ({ width: 6000, height: 4000, draw });
    await prepareUpload(new File(["abc"], "river.jpg", { type: "image/jpeg" }), decode);
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it("refuses when the re-encoded preview is still over 2 MB", async () => {
    const draw = vi.fn(async () => new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: "image/jpeg" }));
    const close = vi.fn();
    const decode: Decoder = async () => ({ width: 6000, height: 4000, draw, close });

    const failure = await prepareUpload(new File(["abc"], "busy.jpg", { type: "image/jpeg" }), decode).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(UnreadableImageError);
    expect((failure as Error).message).toBe("busy.jpg's preview is too large.");
    expect(draw).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("explains when the browser cannot read the image", async () => {
    const decode: Decoder = async () => {
      throw new Error("The source image could not be decoded.");
    };
    const failure = await prepareUpload(new File(["x"], "IMG_2.HEIC", { type: "image/heic" }), decode).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(UnreadableImageError);
    expect((failure as Error).message).toBe("IMG_2.HEIC could not be read by this browser. Export it as a JPEG and try again.");
  });
});

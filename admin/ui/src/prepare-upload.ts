export const PREVIEW_EDGE = 1600;
const MAX_BYTES = 60 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const RETRY_QUALITY = 0.7;

const BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
};
const ACCEPTED = new Set(Object.values(BY_EXTENSION));

export class UnreadableImageError extends Error {}

export type Decoded = {
  width: number;
  height: number;
  /** Encodes a JPEG at `target` size; `quality` defaults to the decoder's own (0.85). */
  draw(target: { width: number; height: number }, quality?: number): Promise<Blob>;
  /** Releases the decoded image once no more previews will be drawn from it. */
  close?(): void;
};
export type Decoder = (file: File) => Promise<Decoded>;

export type Prepared = {
  file: File;
  contentType: string;
  contentHash: string;
  width: number;
  height: number;
  preview: Blob;
};

export function previewSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, PREVIEW_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// A real browser's crypto.subtle.digest accepts any ArrayBuffer, including
// one read from a File. Under Vitest's jsdom test environment, though, source
// runs inside jsdom's own VM context, whose ArrayBuffer is a distinct object
// from the one Node's real crypto.subtle.digest recognises — a File's bytes
// come back as that foreign-realm ArrayBuffer and digest() rejects it. Node's
// Buffer class is unaffected (jsdom does not touch it), so copying through it
// yields a buffer digest() accepts. Real browsers have no `Buffer` global, so
// this branch never runs there and never copies file bytes twice.
function nativeArrayBuffer(bytes: ArrayBuffer): ArrayBuffer {
  if (typeof Buffer === "undefined") return bytes;
  const buffer = Buffer.from(new Uint8Array(bytes));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function contentTypeOf(file: File): string | null {
  if (ACCEPTED.has(file.type)) return file.type;
  if (file.type) return null;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXTENSION[extension] ?? null;
}

export const browserDecoder: Decoder = async (file) => {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  return {
    width: bitmap.width,
    height: bitmap.height,
    async draw(target, quality = 0.85) {
      if (typeof OffscreenCanvas !== "undefined") {
        const canvas = new OffscreenCanvas(target.width, target.height);
        canvas.getContext("2d")!.drawImage(bitmap, 0, 0, target.width, target.height);
        return await canvas.convertToBlob({ type: "image/jpeg", quality });
      }
      const canvas = document.createElement("canvas");
      canvas.width = target.width;
      canvas.height = target.height;
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, target.width, target.height);
      return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no preview"))), "image/jpeg", quality),
      );
    },
    close() {
      bitmap.close();
    },
  };
};

// Reads the whole file into memory once, to hash it — deliberately not
// streamed. A 60 MB original therefore needs about 60 MB for this ArrayBuffer
// at its peak (freed once contentHash resolves); the caller processes files
// one at a time and never holds more than one such buffer at once.
export async function prepareUpload(file: File, decode: Decoder = browserDecoder): Promise<Prepared> {
  const contentType = contentTypeOf(file);
  if (!contentType) throw new UnreadableImageError(`${file.name} is not a JPEG, PNG, or HEIC photograph.`);
  if (file.size > MAX_BYTES) throw new UnreadableImageError(`${file.name} is larger than 60 MB.`);

  let decoded: Decoded | undefined;
  let preview: Blob;
  try {
    decoded = await decode(file);
    const size = previewSize(decoded.width, decoded.height);
    preview = await decoded.draw(size);
    // A very detailed photograph can exceed the Worker's 2 MB preview limit
    // at the usual quality; one lower-quality attempt nearly always fits.
    if (preview.size > MAX_PREVIEW_BYTES) preview = await decoded.draw(size, RETRY_QUALITY);
  } catch {
    throw new UnreadableImageError(`${file.name} could not be read by this browser. Export it as a JPEG and try again.`);
  } finally {
    decoded?.close?.();
  }
  if (preview.size > MAX_PREVIEW_BYTES) throw new UnreadableImageError(`${file.name}'s preview is too large.`);

  return {
    file,
    contentType,
    contentHash: await sha256Hex(nativeArrayBuffer(await file.arrayBuffer())),
    width: decoded.width,
    height: decoded.height,
    preview,
  };
}

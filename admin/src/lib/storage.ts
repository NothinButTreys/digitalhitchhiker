export function declaredLength(request: Request): number | null {
  const header = request.headers.get("content-length");
  if (!header || !/^\d+$/.test(header)) return null;
  return Number(header);
}

/**
 * Streams `body` into R2 at `key` through a `FixedLengthStream` of the declared
 * `length`. The Worker's own memory only ever holds whatever chunk is currently
 * in flight — the stream is piped straight through, never buffered or read into
 * an ArrayBuffer — and R2 is told the exact byte count up front rather than
 * relying on it being inferable from the incoming request's stream.
 */
export function putStreamed(
  bucket: R2Bucket,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  key: string,
  body: ReadableStream<Uint8Array>,
  length: number,
  options: R2PutOptions,
): Promise<R2Object> {
  const fixed = new FixedLengthStream(length);
  ctx.waitUntil(body.pipeTo(fixed.writable).catch(() => {}));
  return bucket.put(key, fixed.readable, options);
}

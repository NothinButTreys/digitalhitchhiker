import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryError, createLibrary } from "./library";

const HASH = "a".repeat(64);
const config = { url: "https://admin.example/", clientId: "id.access", clientSecret: "s3cret" };
const snapshot = {
  version: 1,
  categories: [{
    slug: "phoenix-zoo", title: "Phoenix Zoo", place: "Arizona", description: "Animals.",
    photos: [{ slug: "tiger", title: "Tiger", alt: "A tiger resting", description: "A tiger.", contentHash: HASH, contentType: "image/jpeg", originalName: "IMG_1.jpg" }],
  }],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("createLibrary", () => {
  it("sends the service token on every request and never follows a redirect", async () => {
    const fetch = vi.fn(async () => json({ id: "p1", target: "preview", snapshot }));
    const library = createLibrary(config, fetch as unknown as typeof globalThis.fetch);
    expect(await library.getSnapshot("p1")).toEqual({ target: "preview", snapshot });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://admin.example/api/service/publishes/p1/snapshot");
    const headers = new Headers(init.headers);
    expect(headers.get("cf-access-client-id")).toBe("id.access");
    expect(headers.get("cf-access-client-secret")).toBe("s3cret");
    expect(init.redirect).toBe("manual");
  });

  it("refuses a snapshot it cannot use", async () => {
    const library = createLibrary(config, (async () => json({ id: "p1", target: "preview", snapshot: { version: 2 } })) as unknown as typeof fetch);
    await expect(library.getSnapshot("p1")).rejects.toThrow(/cannot use/);
  });

  it("reads the published snapshot", async () => {
    const library = createLibrary(config, (async () => json({ snapshot, finishedAt: "2026-09-30T00:00:00.000Z" })) as unknown as typeof fetch);
    expect(await library.getPublished()).toEqual(snapshot);
  });

  it("gives null for a cached file that is not there, and its bytes when it is", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ error: "not_found" }, 404))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    const library = createLibrary(config, fetch as unknown as typeof globalThis.fetch);
    expect(await library.getDerived(HASH, "640.avif")).toBeNull();
    expect([...(await library.getDerived(HASH, "640.avif"))!]).toEqual([1, 2, 3]);
    expect(fetch.mock.calls[0]![0]).toBe(`https://admin.example/api/service/derived/${HASH}/640.avif`);
  });

  it("stores a cached file with its length", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const library = createLibrary(config, fetch as unknown as typeof globalThis.fetch);
    await library.putDerived(HASH, "meta.json", Buffer.from("{}"));
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://admin.example/api/service/derived/${HASH}/meta.json`);
    expect(init.method).toBe("PUT");
    expect(new Headers(init.headers).get("content-length")).toBe("2");
  });

  it("downloads an original to a file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dh-library-"));
    dirs.push(dir);
    const fetch = vi.fn(async (..._args: unknown[]) => new Response("original bytes"));
    const library = createLibrary(config, fetch as unknown as typeof globalThis.fetch);
    const target = path.join(dir, "original.jpg");
    await library.originalsFor("p1").downloadOriginal(HASH, target);
    expect(fetch.mock.calls[0]![0]).toBe(`https://admin.example/api/service/publishes/p1/originals/${HASH}`);
    expect(await readFile(target, "utf8")).toBe("original bytes");
  });

  it("reports a status, and says whether the publish was still open", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ status: "running" }))
      .mockResolvedValueOnce(json({ error: "publish_finished" }, 409));
    const library = createLibrary(config, fetch as unknown as typeof globalThis.fetch);
    expect(await library.reportStatus("p1", { status: "running", message: "Working" })).toBe(true);
    expect(await library.reportStatus("p1", { status: "failed", message: "Late" })).toBe(false);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ status: "running", message: "Working", url: "" });
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("names what was refused by path and status, never the library's address or the secret", async () => {
    const library = createLibrary(config, (async () => new Response(null, { status: 302 })) as unknown as typeof fetch);
    const error = await library.getSnapshot("p1").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LibraryError);
    expect((error as LibraryError).status).toBe(302);
    expect((error as Error).message).toBe("The library answered 302 to GET /api/service/publishes/p1/snapshot. A 302 means it did not accept the service token.");
    expect((error as Error).message).not.toContain("admin.example");
    expect((error as Error).message).not.toContain("s3cret");
  });

  it("encodes a publish id that would otherwise change the path", async () => {
    const fetch = vi.fn(async (..._args: unknown[]) => json({ target: "preview", snapshot }));
    const library = createLibrary(config, fetch as unknown as typeof globalThis.fetch);
    await library.getSnapshot("../x/y");
    expect(fetch.mock.calls[0]![0]).toBe("https://admin.example/api/service/publishes/..%2Fx%2Fy/snapshot");
    await library.reportStatus("a/b", { status: "running", message: "m" }).catch(() => undefined);
    expect(fetch.mock.calls[1]![0]).toBe("https://admin.example/api/service/publishes/a%2Fb/status");
    await library.originalsFor("a/b").downloadOriginal(HASH, "/nonexistent/never-written").catch(() => undefined);
    expect(fetch.mock.calls[2]![0]).toBe(`https://admin.example/api/service/publishes/a%2Fb/originals/${HASH}`);
  });

  it("gives every request a time limit", async () => {
    const fetch = vi.fn(async (..._args: unknown[]) => json({ snapshot }));
    await createLibrary(config, fetch as unknown as typeof globalThis.fetch).getPublished();
    expect((fetch.mock.calls[0]![1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it("says only that an answer could not be read, never what it held", async () => {
    const library = createLibrary(
      config,
      (async () => new Response("<html>secret-body-text s3cret</html>", { status: 200 })) as unknown as typeof fetch,
    );
    const error = await library.getPublished().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LibraryError);
    expect((error as LibraryError).status).toBe(200);
    expect((error as Error).message).toBe("The library's answer to GET /api/service/published could not be read.");
    expect((error as Error).cause).toBeUndefined();
  });

  it("says so when the library cannot be reached, without its address", async () => {
    const library = createLibrary(config, (async () => {
      throw new TypeError("fetch failed: getaddrinfo ENOTFOUND admin.example");
    }) as unknown as typeof fetch);
    const error = await library.getPublished().catch((caught: unknown) => caught);
    expect((error as Error).message).toBe("The library could not be reached for GET /api/service/published.");
  });
});

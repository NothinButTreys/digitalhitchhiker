import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createPublish, recordStatus } from "../src/db/publishes";
import { buildSnapshot } from "../src/db/snapshot";
import { api, approved, resetDb, seedCategory, seedPhoto, service } from "./helpers";

beforeEach(resetDb);

const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

/** The body's bytes read as UTF-8. Response.text() on an image type makes the test pool warn. */
async function bytesAsText(response: Response): Promise<string> {
  return new TextDecoder().decode(await response.arrayBuffer());
}

/** One live category with one shown photograph whose hash is a real 64-character one, and a queued publish of it. */
async function seedPublish() {
  const category = await seedCategory({ title: "Alpha" });
  const photoId = await seedPhoto(category.id, { ...approved, slug: "one", selected: 1, position: 1 });
  await env.DB.prepare("UPDATE photos SET content_hash = ? WHERE id = ?").bind(HASH, photoId).run();
  const { snapshot } = await buildSnapshot(env.DB);
  const publish = await createPublish(env.DB, "preview", snapshot, new Date());
  return { category, photoId, snapshot, publish };
}

describe("who may call the service endpoints", () => {
  it("refuses the owner, a stranger, and a different service", async () => {
    const { publish } = await seedPublish();
    const path = `/api/service/publishes/${publish.id}/snapshot`;
    expect((await api(path)).status).toBe(403);
    expect((await api(path, { as: null })).status).toBe(401);
    expect((await api(path, { as: null, headers: { "x-dev-service-id": "someone-else.access" } })).status).toBe(401);
    expect((await service(path)).status).toBe(200);
  });

  it("keeps the service out of every owner endpoint", async () => {
    expect((await service("/api/categories")).status).toBe(403);
    expect((await service("/api/publishes/state")).status).toBe(403);
    expect((await service("/api/me")).status).toBe(200);
  });
});

describe("snapshot", () => {
  it("gives the publish's target and the snapshot it was started with", async () => {
    const { publish, snapshot } = await seedPublish();
    await env.DB.prepare("UPDATE photos SET title = 'Changed after pressing Publish'").run();
    const response = await service(`/api/service/publishes/${publish.id}/snapshot`);
    expect(await response.json()).toEqual({ id: publish.id, target: "preview", snapshot });
  });

  it("answers not found for an unknown publish", async () => {
    expect((await service("/api/service/publishes/nope/snapshot")).status).toBe(404);
  });
});

describe("status", () => {
  it("records progress, then the outcome and its address", async () => {
    const { publish } = await seedPublish();
    const path = `/api/service/publishes/${publish.id}/status`;
    const running = await service(path, { method: "POST", json: { status: "running", message: "Preparing 1 of 1" } });
    expect(await running.json()).toMatchObject({ status: "running", message: "Preparing 1 of 1", url: "" });
    const done = await service(path, { method: "POST", json: { status: "succeeded", message: "Done", url: "https://preview.example/x" } });
    expect(await done.json()).toMatchObject({ status: "succeeded", url: "https://preview.example/x" });
    const late = await service(path, { method: "POST", json: { status: "failed", message: "too late" } });
    expect(late.status).toBe(409);
    expect(((await late.json()) as { error: string }).error).toBe("publish_finished");
  });

  it("refuses an unknown status, an address that is not https, and a body that is not JSON", async () => {
    const { publish } = await seedPublish();
    const path = `/api/service/publishes/${publish.id}/status`;
    expect((await service(path, { method: "POST", json: { status: "queued" } })).status).toBe(400);
    expect((await service(path, { method: "POST", json: { status: "succeeded", url: "javascript:alert(1)" } })).status).toBe(400);
    expect((await service(path, { method: "POST", body: "status=failed", headers: { "content-type": "text/plain" } })).status).toBe(415);
  });
});

describe("originals", () => {
  it("streams the original of a photograph in the publish, while the publish is unfinished", async () => {
    const { publish } = await seedPublish();
    const response = await service(`/api/service/publishes/${publish.id}/originals/${HASH}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await bytesAsText(response)).toBe("original-bytes");
  });

  it("refuses an original that is not in the publish, even though it is in the library", async () => {
    const { publish, category } = await seedPublish();
    const unshown = await seedPhoto(category.id, { ...approved, slug: "two" });
    await env.DB.prepare("UPDATE photos SET content_hash = ? WHERE id = ?").bind(OTHER_HASH, unshown).run();
    expect((await service(`/api/service/publishes/${publish.id}/originals/${OTHER_HASH}`)).status).toBe(404);
  });

  it("refuses every original once the publish has finished", async () => {
    const { publish } = await seedPublish();
    await recordStatus(env.DB, publish.id, { status: "succeeded", message: "", url: "" }, new Date());
    const response = await service(`/api/service/publishes/${publish.id}/originals/${HASH}`);
    expect(response.status).toBe(409);
  });
});

describe("derived files", () => {
  const put = (hash: string, file: string, body: string, headers: Record<string, string> = {}) =>
    service(`/api/service/derived/${hash}/${file}`, {
      method: "PUT",
      body,
      headers: { "content-length": String(body.length), ...headers },
    });

  it("stores a file and gives it back with its type", async () => {
    await seedPublish();
    expect((await service(`/api/service/derived/${HASH}/640.avif`)).status).toBe(404);
    expect((await put(HASH, "640.avif", "avif-bytes")).status).toBe(204);
    expect((await put(HASH, "meta.json", '{"width":640}')).status).toBe(204);

    const image = await service(`/api/service/derived/${HASH}/640.avif`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/avif");
    expect(await bytesAsText(image)).toBe("avif-bytes");
    const meta = await service(`/api/service/derived/${HASH}/meta.json`);
    expect(meta.headers.get("content-type")).toBe("application/json");
    expect(await meta.json()).toEqual({ width: 640 });
    expect((await env.BUCKET.head(`derived/${HASH}/640.avif`))?.size).toBe(10);
  });

  it("does not serve a file whose photograph is gone", async () => {
    const { photoId } = await seedPublish();
    expect((await put(HASH, "640.avif", "avif-bytes")).status).toBe(204);
    expect((await service(`/api/service/derived/${HASH}/640.avif`)).status).toBe(200);
    await env.DB.prepare("DELETE FROM photos WHERE id = ?").bind(photoId).run();
    expect(await env.BUCKET.head(`derived/${HASH}/640.avif`)).not.toBeNull();
    expect((await service(`/api/service/derived/${HASH}/640.avif`)).status).toBe(404);
  });

  it("refuses a file for a hash that no photograph has", async () => {
    await seedPublish();
    expect((await put(OTHER_HASH, "640.avif", "x")).status).toBe(404);
    expect(await env.BUCKET.head(`derived/${OTHER_HASH}/640.avif`)).toBeNull();
  });

  it("refuses names and hashes that are not the expected shape", async () => {
    await seedPublish();
    for (const file of ["evil.html", "0.avif", "640.png", "640.avif.exe", "meta.json.bak"]) {
      expect((await put(HASH, file, "x")).status, file).toBe(400);
      expect((await service(`/api/service/derived/${HASH}/${file}`)).status, file).toBe(400);
    }
    expect((await put("not-a-hash", "640.avif", "x")).status).toBe(400);
    expect((await put(HASH.toUpperCase(), "640.avif", "x")).status).toBe(400);
  });

  // The test pool's fetch sends the `content-length` it is given even when it
  // disagrees with the body (test/uploads.test.ts relies on the same thing),
  // so a declared length over the limit needs no 40 MB body.
  it("refuses a file declared larger than 40 MB, storing nothing", async () => {
    await seedPublish();
    const huge = await put(HASH, "640.avif", "x", { "content-length": String(40 * 1024 * 1024 + 1) });
    expect(huge.status).toBe(413);
    expect(await env.BUCKET.head(`derived/${HASH}/640.avif`)).toBeNull();
  });
});

describe("published", () => {
  it("gives the newest production publish that succeeded, and nothing before there is one", async () => {
    const { publish, snapshot } = await seedPublish();
    expect((await service("/api/service/published")).status).toBe(404);
    await recordStatus(env.DB, publish.id, { status: "succeeded", message: "", url: "" }, new Date());
    expect((await service("/api/service/published")).status).toBe(404);

    const live = await createPublish(env.DB, "production", snapshot, new Date(Date.UTC(2026, 8, 30, 12)));
    await recordStatus(env.DB, live.id, { status: "succeeded", message: "", url: "" }, new Date(Date.UTC(2026, 8, 30, 13)));
    const response = await service("/api/service/published");
    expect(await response.json()).toEqual({ snapshot, finishedAt: "2026-09-30T13:00:00.000Z" });
  });
});

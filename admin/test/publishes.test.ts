import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublishOut, PublishState } from "../src/db/publishes";
import { github } from "../src/lib/github";
import worker from "../src/index";
import { api, approved, resetDb, seedCategory, seedPhoto } from "./helpers";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

async function seedLive() {
  const category = await seedCategory({ title: "Alpha" });
  await seedPhoto(category.id, { ...approved, slug: "one", selected: 1, position: 1 });
}

const start = (target: string) => api("/api/publishes", { method: "POST", json: { target } });
const state = async () => (await (await api("/api/publishes/state")).json()) as PublishState;

describe("POST /api/publishes", () => {
  it("records a publish, starts the workflow with its id, and answers 201", async () => {
    const fetch = vi.spyOn(github, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await seedLive();
    const response = await start("preview");
    expect(response.status).toBe(201);
    const publish = (await response.json()) as PublishOut;
    expect(publish).toMatchObject({ target: "preview", status: "queued" });
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string).inputs).toEqual({ publish_id: publish.id, target: "preview" });
    expect((await state()).latest).toMatchObject({ id: publish.id, status: "queued" });
  });

  it("refuses when nothing is shown, without starting anything", async () => {
    const fetch = vi.spyOn(github, "fetch");
    await seedCategory({ title: "Alpha" });
    const response = await start("production");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "not_publishable",
      message: "Nothing is shown in any category, so there is nothing to publish.",
      problems: ["Nothing is shown in any category, so there is nothing to publish."],
    });
    expect(fetch).not.toHaveBeenCalled();
    expect((await state()).latest).toBeNull();
  });

  it("refuses a second publish while one is under way", async () => {
    vi.spyOn(github, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await seedLive();
    expect((await start("preview")).status).toBe(201);
    const second = await start("production");
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: string }).error).toBe("publish_running");
  });

  it("marks the publish failed, with the reason, when the workflow cannot be started", async () => {
    vi.spyOn(github, "fetch").mockResolvedValue(new Response(null, { status: 403 }));
    await seedLive();
    const response = await start("preview");
    expect(response.status).toBe(502);
    expect(((await response.json()) as { message: string }).message).toBe("GitHub refused to start the publish (status 403).");
    expect((await state()).latest).toMatchObject({ status: "failed", message: "GitHub refused to start the publish (status 403)." });
    // A failed start does not block the next try.
    vi.spyOn(github, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    expect((await start("preview")).status).toBe(201);
  });

  it("refuses an unknown target, a body that is not JSON, and anyone but the owner", async () => {
    await seedLive();
    expect((await start("staging")).status).toBe(400);
    expect((await api("/api/publishes", { method: "POST", body: "target=preview", headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect((await api("/api/publishes", { method: "POST", json: { target: "preview" }, as: null })).status).toBe(401);
    expect((await api("/api/publishes", { method: "POST", json: { target: "preview" }, as: "someone@example.com" })).status).toBe(401);
  });
});

describe("GET /api/publishes/state", () => {
  it("describes a library that has never been published", async () => {
    await seedLive();
    expect(await state()).toEqual({
      latest: null,
      published: null,
      unpublishedChanges: true,
      problems: [],
      summary: { categories: 1, photographs: 1 },
    });
  });
});

describe("the nightly run", () => {
  it("gives up on a publish that stopped reporting", async () => {
    vi.spyOn(github, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await seedLive();
    const publish = (await (await start("preview")).json()) as PublishOut;
    await env.DB.prepare("UPDATE publishes SET updated_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").bind(publish.id).run();

    const ctx = createExecutionContext();
    await worker.scheduled({} as ScheduledController, env, ctx);
    await waitOnExecutionContext(ctx);

    const row = await env.DB.prepare("SELECT status, active FROM publishes WHERE id = ?").bind(publish.id).first();
    expect(row).toEqual({ status: "failed", active: null });
  });
});

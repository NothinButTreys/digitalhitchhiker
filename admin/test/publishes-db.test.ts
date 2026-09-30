import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  STALE_AFTER_MS,
  createPublish,
  failStalePublishes,
  getPublishRow,
  lastPublishedSnapshot,
  latestPublish,
  publishState,
  recordStatus,
} from "../src/db/publishes";
import type { Snapshot } from "../src/db/snapshot";
import { approved, resetDb, seedCategory, seedPhoto } from "./helpers";

beforeEach(resetDb);

const snapshot: Snapshot = { version: 1, categories: [] };
const at = (minutes: number) => new Date(Date.UTC(2026, 8, 30, 12, minutes));

describe("createPublish", () => {
  it("records a queued publish with its snapshot", async () => {
    const publish = await createPublish(env.DB, "preview", snapshot, at(0));
    expect(publish).toEqual({
      id: publish.id,
      target: "preview",
      status: "queued",
      message: "",
      url: "",
      startedAt: at(0).toISOString(),
      updatedAt: at(0).toISOString(),
      finishedAt: null,
    });
    expect(publish.id).toMatch(/^[0-9a-f-]{36}$/);
    const row = await getPublishRow(env.DB, publish.id);
    expect(row?.active).toBe(1);
    expect(JSON.parse(row!.snapshot)).toEqual(snapshot);
  });

  it("refuses a second publish while one is unfinished, and allows one after it finishes", async () => {
    const first = await createPublish(env.DB, "preview", snapshot, at(0));
    await expect(createPublish(env.DB, "production", snapshot, at(1))).rejects.toMatchObject({
      status: 409,
      code: "publish_running",
    });
    await recordStatus(env.DB, first.id, { status: "failed", message: "stopped", url: "" }, at(2));
    await expect(createPublish(env.DB, "production", snapshot, at(3))).resolves.toMatchObject({ status: "queued" });
  });
});

describe("recordStatus", () => {
  it("moves from queued to running to succeeded, keeping the address once given", async () => {
    const { id } = await createPublish(env.DB, "preview", snapshot, at(0));
    const running = await recordStatus(env.DB, id, { status: "running", message: "Preparing 1 of 3", url: "" }, at(1));
    expect(running).toMatchObject({ status: "running", message: "Preparing 1 of 3", finishedAt: null, updatedAt: at(1).toISOString() });
    await recordStatus(env.DB, id, { status: "running", message: "Deploying", url: "https://preview.example" }, at(2));
    const done = await recordStatus(env.DB, id, { status: "succeeded", message: "Done", url: "" }, at(3));
    expect(done).toMatchObject({ status: "succeeded", message: "Done", url: "https://preview.example", finishedAt: at(3).toISOString() });
    expect((await getPublishRow(env.DB, id))?.active).toBeNull();
  });

  it("refuses to change a publish that has finished", async () => {
    const { id } = await createPublish(env.DB, "preview", snapshot, at(0));
    await recordStatus(env.DB, id, { status: "failed", message: "no", url: "" }, at(1));
    await expect(recordStatus(env.DB, id, { status: "succeeded", message: "yes", url: "" }, at(2))).rejects.toMatchObject({
      status: 409,
      code: "publish_finished",
    });
    expect((await latestPublish(env.DB))?.status).toBe("failed");
  });

  it("answers not found for an unknown publish", async () => {
    await expect(recordStatus(env.DB, "nope", { status: "running", message: "", url: "" }, at(0))).rejects.toMatchObject({ status: 404 });
  });
});

describe("failStalePublishes", () => {
  it("gives up on a publish that has not reported for thirty minutes, and on no other", async () => {
    const { id } = await createPublish(env.DB, "preview", snapshot, at(0));
    expect(await failStalePublishes(env.DB, new Date(at(0).getTime() + STALE_AFTER_MS - 1))).toBe(0);
    expect(await failStalePublishes(env.DB, new Date(at(0).getTime() + STALE_AFTER_MS + 1))).toBe(1);
    const row = await getPublishRow(env.DB, id);
    expect(row).toMatchObject({ status: "failed", active: null, message: "The publish stopped reporting and was given up on." });
    expect(row?.finished_at).not.toBeNull();
  });

  it("counts from the last report, not from the start", async () => {
    const { id } = await createPublish(env.DB, "preview", snapshot, at(0));
    await recordStatus(env.DB, id, { status: "running", message: "still going", url: "" }, at(25));
    expect(await failStalePublishes(env.DB, at(40))).toBe(0);
    expect(await failStalePublishes(env.DB, at(56))).toBe(1);
  });
});

describe("lastPublishedSnapshot and publishState", () => {
  it("only counts a production publish that succeeded", async () => {
    const preview = await createPublish(env.DB, "preview", snapshot, at(0));
    await recordStatus(env.DB, preview.id, { status: "succeeded", message: "", url: "" }, at(1));
    const failed = await createPublish(env.DB, "production", snapshot, at(2));
    await recordStatus(env.DB, failed.id, { status: "failed", message: "", url: "" }, at(3));
    expect(await lastPublishedSnapshot(env.DB)).toBeNull();

    const live = await createPublish(env.DB, "production", snapshot, at(4));
    await recordStatus(env.DB, live.id, { status: "succeeded", message: "", url: "" }, at(5));
    expect(await lastPublishedSnapshot(env.DB)).toEqual({ snapshot, finishedAt: at(5).toISOString() });
  });

  it("reports unpublished changes until a production publish of the same library succeeds", async () => {
    const category = await seedCategory({ title: "Alpha" });
    const photoId = await seedPhoto(category.id, { ...approved, slug: "one", selected: 1, position: 1 });

    const before = await publishState(env.DB, at(0));
    expect(before).toEqual({
      latest: null,
      published: null,
      unpublishedChanges: true,
      problems: [],
      summary: { categories: 1, photographs: 1 },
    });

    const { snapshot: current } = await (await import("../src/db/snapshot")).buildSnapshot(env.DB);
    const publish = await createPublish(env.DB, "production", current, at(1));
    await recordStatus(env.DB, publish.id, { status: "succeeded", message: "", url: "" }, at(2));
    const after = await publishState(env.DB, at(3));
    expect(after.unpublishedChanges).toBe(false);
    expect(after.published).toEqual({ finishedAt: at(2).toISOString() });
    expect(after.latest?.status).toBe("succeeded");

    await env.DB.prepare("UPDATE photos SET title = 'Renamed' WHERE id = ?").bind(photoId).run();
    expect((await publishState(env.DB, at(4))).unpublishedChanges).toBe(true);
  });

  it("gives the reason when nothing can be published, and gives up on a silent publish while reading", async () => {
    await createPublish(env.DB, "preview", snapshot, at(0));
    const state = await publishState(env.DB, at(45));
    expect(state.problems).toEqual(["Nothing is shown in any category, so there is nothing to publish."]);
    expect(state.unpublishedChanges).toBe(false);
    expect(state.latest?.status).toBe("failed");
  });
});

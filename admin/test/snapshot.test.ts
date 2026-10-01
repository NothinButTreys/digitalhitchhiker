import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { buildSnapshot, sameSnapshot, summarize } from "../src/db/snapshot";
import { api, approved, resetDb, seedCategory, seedPhoto } from "./helpers";

beforeEach(resetDb);

const shown = (slug: string, position: number) => ({ ...approved, slug, title: slug, selected: 1 as const, position });

describe("buildSnapshot", () => {
  it("lists live categories in order, each with its shown photographs in order", async () => {
    const a = await seedCategory({ title: "Alpha" });
    const b = await seedCategory({ title: "Beta" });
    await seedPhoto(b.id, shown("b-one", 1));
    await seedPhoto(a.id, shown("a-two", 2));
    await seedPhoto(a.id, shown("a-one", 1));
    await seedPhoto(a.id, { ...approved, slug: "a-unshown" });

    const { snapshot, problems } = await buildSnapshot(env.DB);
    expect(problems).toEqual([]);
    expect(snapshot.version).toBe(1);
    expect(snapshot.categories.map((c) => [c.slug, c.title, c.photos.map((p) => p.slug)])).toEqual([
      ["alpha", "Alpha", ["a-one", "a-two"]],
      ["beta", "Beta", ["b-one"]],
    ]);
    const photo = snapshot.categories[0]!.photos[0]!;
    expect(Object.keys(photo).sort()).toEqual(["alt", "contentHash", "contentType", "description", "originalName", "slug", "title"]);
    expect(photo.contentType).toBe("image/jpeg");
    expect(summarize(snapshot)).toEqual({ categories: 2, photographs: 3 });
  });

  it("leaves out a hidden category and a category that shows nothing", async () => {
    const hidden = await seedCategory({ title: "Hidden" });
    await seedPhoto(hidden.id, shown("h-one", 1));
    await api(`/api/categories/${hidden.id}`, { method: "PATCH", json: { hidden: true } });
    const empty = await seedCategory({ title: "Empty" });
    await seedPhoto(empty.id, { ...approved, slug: "unshown" });
    const live = await seedCategory({ title: "Live" });
    await seedPhoto(live.id, shown("l-one", 1));

    const { snapshot, problems } = await buildSnapshot(env.DB);
    expect(problems).toEqual([]);
    expect(snapshot.categories.map((c) => c.slug)).toEqual(["live"]);
  });

  it("follows the order the categories were put in", async () => {
    const a = await seedCategory({ title: "Alpha" });
    const b = await seedCategory({ title: "Beta" });
    await seedPhoto(a.id, shown("a-one", 1));
    await seedPhoto(b.id, shown("b-one", 1));
    await api("/api/categories/order", { method: "PUT", json: { ids: [b.id, a.id] } });
    const { snapshot } = await buildSnapshot(env.DB);
    expect(snapshot.categories.map((c) => c.slug)).toEqual(["beta", "alpha"]);
  });

  it("says there is nothing to publish when nothing is shown", async () => {
    await seedCategory({ title: "Alpha" });
    const { snapshot, problems } = await buildSnapshot(env.DB);
    expect(snapshot.categories).toEqual([]);
    expect(problems).toEqual(["Nothing is shown in any category, so there is nothing to publish."]);
  });

  it("names a shown photograph whose text is not approved, and leaves it out", async () => {
    const a = await seedCategory({ title: "Alpha" });
    await seedPhoto(a.id, shown("a-one", 1));
    await seedPhoto(a.id, { slug: null, title: "Half done", text_status: "needs_text", selected: 1, position: 2 });
    const { snapshot, problems } = await buildSnapshot(env.DB);
    expect(problems).toEqual(["Half done in Alpha has no approved text."]);
    expect(snapshot.categories[0]!.photos.map((p) => p.slug)).toEqual(["a-one"]);
  });

  it("publishes a category however many photographs it shows", async () => {
    const a = await seedCategory({ title: "Alpha" });
    for (let index = 1; index <= 12; index += 1) await seedPhoto(a.id, shown(`p-${index}`, index));
    const { snapshot, problems } = await buildSnapshot(env.DB);
    expect(problems).toEqual([]);
    expect(snapshot.categories[0]!.photos).toHaveLength(12);
  });
});

describe("sameSnapshot", () => {
  it("is true for two snapshots of an unchanged library and false after a change", async () => {
    const a = await seedCategory({ title: "Alpha" });
    const id = await seedPhoto(a.id, shown("a-one", 1));
    const first = (await buildSnapshot(env.DB)).snapshot;
    expect(sameSnapshot(first, (await buildSnapshot(env.DB)).snapshot)).toBe(true);
    await env.DB.prepare("UPDATE photos SET title = 'Renamed' WHERE id = ?").bind(id).run();
    expect(sameSnapshot(first, (await buildSnapshot(env.DB)).snapshot)).toBe(false);
  });
});

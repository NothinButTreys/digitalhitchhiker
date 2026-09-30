import { env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppEnv } from "../src/env";
import { ApiError } from "../src/lib/errors";
import { renumberStatements } from "../src/db/photos";
import { photos as photosApp } from "../src/routes/photos";
import { api, approved, resetDb, seedCategory, seedPhoto } from "./helpers";

beforeEach(resetDb);

const json = async (response: Response) => (await response.json()) as any;
const text = { title: "Tiger", alt: "A tiger resting in dry grass", description: "A tiger at rest." };

// photosApp has no auth middleware of its own (only mounted where it is
// composed under the top-level app), so it can be called directly with a
// wrapped DB. It also has no onError of its own, so this wraps it with the
// same error mapping the top-level app supplies in production, purely to
// make the response observable in isolation. Same pattern as
// categories.test.ts's directCategoriesApp.
function directPhotosApp() {
  const app = new Hono<AppEnv>();
  app.route("/", photosApp);
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json({ error: error.code, message: error.message, ...error.details }, error.status);
    }
    console.error(error);
    return c.json({ error: "internal", message: "Something went wrong." }, 500);
  });
  return app;
}

// Delegates every call to the real prepared statement except the ones named
// in `overrides`, and carries those overrides through `.bind()` so the
// override still applies to the bound statement `bind()` returns. Same
// pattern as categories.test.ts's overrideStatement.
function overrideStatement(
  statement: D1PreparedStatement,
  overrides: Partial<D1PreparedStatement>,
): D1PreparedStatement {
  return new Proxy(statement, {
    get(target, prop, receiver) {
      if (prop === "bind") {
        return (...args: unknown[]) =>
          overrideStatement((target.bind as (...a: unknown[]) => D1PreparedStatement)(...args), overrides);
      }
      if (prop in overrides) return overrides[prop as keyof D1PreparedStatement];
      return Reflect.get(target, prop, receiver);
    },
  });
}

describe("listing photographs", () => {
  it("lists selected in order, then the rest newest first", async () => {
    const category = await seedCategory();
    const older = await seedPhoto(category.id);
    const newer = await seedPhoto(category.id);
    const second = await seedPhoto(category.id, { ...approved, selected: 1, position: 2 });
    const first = await seedPhoto(category.id, { ...approved, selected: 1, position: 1 });
    const { photos } = await json(await api(`/api/categories/${category.id}/photos`));
    expect(photos.map((p: any) => p.id)).toEqual([first, second, newer, older]);
    expect(photos[0]).toMatchObject({
      categoryId: category.id,
      selected: true,
      position: 1,
      textStatus: "approved",
      width: 3000,
      height: 2000,
      source: "upload",
      previewUrl: `/api/photos/${first}/preview`,
    });
    expect(photos[0]).not.toHaveProperty("original_key");
    expect(photos[0]).not.toHaveProperty("contentHash");
  });

  it("returns 404 for an unknown category", async () => {
    expect((await api("/api/categories/nope/photos")).status).toBe(404);
  });
});

describe("preview", () => {
  it("serves the preview image privately", async () => {
    const category = await seedCategory();
    const id = await seedPhoto(category.id);
    const response = await api(`/api/photos/${id}/preview`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe("preview-bytes");
  });

  it("returns 404 when the photograph or its file is missing", async () => {
    const category = await seedCategory();
    const id = await seedPhoto(category.id);
    await env.BUCKET.delete(`previews/${id}.jpg`);
    expect((await api(`/api/photos/${id}/preview`)).status).toBe(404);
    expect((await api("/api/photos/nope/preview")).status).toBe(404);
  });

  it("refuses without an identity", async () => {
    const category = await seedCategory();
    const id = await seedPhoto(category.id);
    expect((await api(`/api/photos/${id}/preview`, { as: null })).status).toBe(401);
  });
});

describe("approving text", () => {
  it("approves, trims, and sets a slug from the title", async () => {
    const category = await seedCategory();
    const id = await seedPhoto(category.id);
    const response = await api(`/api/photos/${id}/text`, {
      method: "PUT",
      json: { title: "  Old town, snow ", alt: " A snowy street lined with brick buildings ", description: " Snow on a street. " },
    });
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      title: "Old town, snow",
      alt: "A snowy street lined with brick buildings",
      description: "Snow on a street.",
      textStatus: "approved",
      slug: "old-town-snow",
    });
  });

  it("makes the slug unique within the category", async () => {
    const category = await seedCategory();
    await seedPhoto(category.id, { ...approved, slug: "tiger" });
    const id = await seedPhoto(category.id);
    expect((await json(await api(`/api/photos/${id}/text`, { method: "PUT", json: text }))).slug).toBe("tiger-2");
  });

  it("allows the same slug in another category", async () => {
    const a = await seedCategory();
    const b = await seedCategory();
    await seedPhoto(a.id, { ...approved, slug: "tiger" });
    const id = await seedPhoto(b.id);
    expect((await json(await api(`/api/photos/${id}/text`, { method: "PUT", json: text }))).slug).toBe("tiger");
  });

  it("keeps the slug when the title is edited later", async () => {
    const category = await seedCategory();
    const id = await seedPhoto(category.id);
    await api(`/api/photos/${id}/text`, { method: "PUT", json: text });
    const edited = await json(await api(`/api/photos/${id}/text`, { method: "PUT", json: { ...text, title: "Resting tiger" } }));
    expect(edited).toMatchObject({ title: "Resting tiger", slug: "tiger" });
  });

  it.each([
    [{ ...text, title: " " }, "title"],
    [{ ...text, alt: "" }, "alt"],
    [{ ...text, description: "" }, "description"],
    [{ ...text, title: "x".repeat(61) }, "title"],
    [{ ...text, alt: "Photo of a tiger in grass" }, "alt"],
    [{ ...text, alt: "an image of a tiger in grass" }, "alt"],
    [{ ...text, alt: "A picture of a tiger" }, "alt"],
  ])("refuses %j", async (body, field) => {
    const category = await seedCategory();
    const id = await seedPhoto(category.id);
    const response = await api(`/api/photos/${id}/text`, { method: "PUT", json: body });
    expect(response.status).toBe(400);
    expect((await json(response)).message).toContain(field);
    expect((await json(await api(`/api/photos/${id}`))).textStatus).toBe("needs_text");
  });
});

describe("selecting", () => {
  it("selects an approved photograph at the end of the order", async () => {
    const category = await seedCategory();
    await seedPhoto(category.id, { ...approved, selected: 1, position: 1 });
    const id = await seedPhoto(category.id, approved);
    const response = await api(`/api/photos/${id}/selected`, { method: "PUT", json: { selected: true } });
    expect(await json(response)).toMatchObject({ selected: true, position: 2 });
  });

  it("refuses a photograph whose text is needs_text", async () => {
    const category = await seedCategory();
    const id = await seedPhoto(category.id);
    const response = await api(`/api/photos/${id}/selected`, { method: "PUT", json: { selected: true } });
    expect(response.status).toBe(409);
    expect((await json(response)).error).toBe("text_not_approved");
  });

  it("refuses a ninth selection and allows it after one is deselected", async () => {
    const category = await seedCategory();
    const selected: string[] = [];
    for (let position = 1; position <= 8; position += 1) {
      selected.push(await seedPhoto(category.id, { ...approved, selected: 1, position }));
    }
    const ninth = await seedPhoto(category.id, approved);
    const refused = await api(`/api/photos/${ninth}/selected`, { method: "PUT", json: { selected: true } });
    expect(refused.status).toBe(409);
    expect((await json(refused)).error).toBe("selection_full");

    await api(`/api/photos/${selected[0]}/selected`, { method: "PUT", json: { selected: false } });
    const allowed = await api(`/api/photos/${ninth}/selected`, { method: "PUT", json: { selected: true } });
    expect(await json(allowed)).toMatchObject({ selected: true, position: 8 });
  });

  it("does not count another category's selections", async () => {
    const full = await seedCategory();
    for (let position = 1; position <= 8; position += 1) {
      await seedPhoto(full.id, { ...approved, selected: 1, position });
    }
    const other = await seedCategory();
    const id = await seedPhoto(other.id, approved);
    expect((await api(`/api/photos/${id}/selected`, { method: "PUT", json: { selected: true } })).status).toBe(200);
  });

  it("changes nothing when selecting a selected photograph", async () => {
    const category = await seedCategory();
    const id = await seedPhoto(category.id, { ...approved, selected: 1, position: 1 });
    expect(await json(await api(`/api/photos/${id}/selected`, { method: "PUT", json: { selected: true } }))).toMatchObject({
      selected: true,
      position: 1,
    });
  });

  it("renumbers the rest when one is deselected", async () => {
    const category = await seedCategory();
    const a = await seedPhoto(category.id, { ...approved, selected: 1, position: 1 });
    const b = await seedPhoto(category.id, { ...approved, selected: 1, position: 2 });
    const c = await seedPhoto(category.id, { ...approved, selected: 1, position: 3 });
    await api(`/api/photos/${a}/selected`, { method: "PUT", json: { selected: false } });
    const { photos } = await json(await api(`/api/categories/${category.id}/photos`));
    expect(photos.filter((p: any) => p.selected).map((p: any) => [p.id, p.position])).toEqual([[b, 1], [c, 2]]);
    expect(photos.find((p: any) => p.id === a)).toMatchObject({ selected: false, position: 0 });
  });

  it("holds the limit of eight when two selections race", async () => {
    const category = await seedCategory();
    for (let position = 1; position <= 7; position += 1) {
      await seedPhoto(category.id, { ...approved, selected: 1, position });
    }
    const eighth = await seedPhoto(category.id, approved);
    const ninth = await seedPhoto(category.id, approved);

    const [first, second] = await Promise.all([
      api(`/api/photos/${eighth}/selected`, { method: "PUT", json: { selected: true } }),
      api(`/api/photos/${ninth}/selected`, { method: "PUT", json: { selected: true } }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    const refused = first.status === 409 ? first : second;
    expect((await json(refused)).error).toBe("selection_full");

    const { photos } = await json(await api(`/api/categories/${category.id}/photos`));
    const selectedPhotos = photos.filter((p: any) => p.selected);
    expect(selectedPhotos).toHaveLength(8);
    expect(selectedPhotos.map((p: any) => p.position).sort((x: number, y: number) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("assigns distinct positions when several selections race from empty", async () => {
    const category = await seedCategory();
    const a = await seedPhoto(category.id, approved);
    const b = await seedPhoto(category.id, approved);
    const c = await seedPhoto(category.id, approved);

    const responses = await Promise.all(
      [a, b, c].map((id) => api(`/api/photos/${id}/selected`, { method: "PUT", json: { selected: true } })),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);

    const { photos } = await json(await api(`/api/categories/${category.id}/photos`));
    const selectedPhotos = photos.filter((p: any) => p.selected);
    expect(selectedPhotos).toHaveLength(3);
    expect(selectedPhotos.map((p: any) => p.position).sort((x: number, y: number) => x - y)).toEqual([1, 2, 3]);
  });

  it("selecting the same photograph twice at once leaves it selected once", async () => {
    const category = await seedCategory();
    const id = await seedPhoto(category.id, approved);

    const responses = await Promise.all([
      api(`/api/photos/${id}/selected`, { method: "PUT", json: { selected: true } }),
      api(`/api/photos/${id}/selected`, { method: "PUT", json: { selected: true } }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);

    const photo = await json(await api(`/api/photos/${id}`));
    expect(photo).toMatchObject({ selected: true, position: 1 });
  });

  function expectConsecutivePositions(photosList: any[]) {
    const selected = photosList.filter((p) => p.selected);
    expect(selected.map((p) => p.position).sort((x: number, y: number) => x - y)).toEqual(
      Array.from({ length: selected.length }, (_, i) => i + 1),
    );
  }

  it("holds the limit against the photograph's current category when a move races with a select", async () => {
    const a = await seedCategory();
    const b = await seedCategory();
    for (let position = 1; position <= 8; position += 1) {
      await seedPhoto(b.id, { ...approved, selected: 1, position });
    }
    const id = await seedPhoto(a.id, approved);

    await Promise.all([
      api(`/api/photos/${id}/category`, { method: "PUT", json: { categoryId: b.id } }),
      api(`/api/photos/${id}/selected`, { method: "PUT", json: { selected: true } }),
    ]);

    // Single end state either order lands in: the photograph is in B, unselected.
    // - If the move's write lands first, the photograph is already in B (which has
    //   8 selected) by the time the select's UPDATE runs, so the select's correlated
    //   subquery counts B's 8 and refuses (selection_full) — the photograph stays
    //   unselected in B.
    // - If the select's write lands first, it runs while the photograph is still in
    //   A (0 selected), so it succeeds and selects the photograph in A — but the move
    //   that follows unconditionally deselects a photograph as part of moving it
    //   (`selected = 0, position = 0`, regardless of its selected state going in), so
    //   it still ends up in B, unselected.
    // Both orders leave B at 8 selected (never 9) and the photograph in B, unselected.
    const photo = await json(await api(`/api/photos/${id}`));
    expect(photo).toMatchObject({ categoryId: b.id, selected: false });

    const { photos: aPhotos } = await json(await api(`/api/categories/${a.id}/photos`));
    const { photos: bPhotos } = await json(await api(`/api/categories/${b.id}/photos`));
    expect(bPhotos.filter((p: any) => p.selected)).toHaveLength(8);
    expectConsecutivePositions(aPhotos);
    expectConsecutivePositions(bPhotos);
  });

  it("checks the limit against the photograph's own category, not any other, deterministically", async () => {
    const a = await seedCategory();
    const b = await seedCategory();
    for (let position = 1; position <= 8; position += 1) {
      await seedPhoto(b.id, { ...approved, selected: 1, position });
    }
    const inFullCategory = await seedPhoto(b.id, approved);
    const refused = await api(`/api/photos/${inFullCategory}/selected`, { method: "PUT", json: { selected: true } });
    expect(refused.status).toBe(409);
    expect((await json(refused)).error).toBe("selection_full");

    const inEmptyCategory = await seedPhoto(a.id, approved);
    const allowed = await api(`/api/photos/${inEmptyCategory}/selected`, { method: "PUT", json: { selected: true } });
    expect(allowed.status).toBe(200);
    expect(await json(allowed)).toMatchObject({ selected: true, position: 1 });
  });

  describe("when the photograph is deleted between the update and the re-read", () => {
    // Simulates the photograph being deleted between the conditional UPDATE (which
    // then finds no row to change) and the route's re-read that decides why: the
    // first `SELECT * FROM photos WHERE id = ?` (the handler's initial read) returns
    // the real, approved, unselected row so the handler proceeds into the UPDATE; the
    // UPDATE is stubbed to report zero changes, as it would if the row had vanished
    // first; every later SELECT for that id returns null, as it truly would once the
    // row is gone.
    function wrapDb(): typeof env.DB {
      let selectCalls = 0;
      return new Proxy(env.DB, {
        get(target, prop, receiver) {
          if (prop === "prepare") {
            return (sql: string) => {
              const real = target.prepare(sql);
              if (sql.startsWith("SELECT * FROM photos WHERE id = ?")) {
                selectCalls += 1;
                if (selectCalls === 1) return real;
                return overrideStatement(real, { first: async () => null });
              }
              if (sql.startsWith("UPDATE photos") && sql.includes("SET selected = 1")) {
                return overrideStatement(real, {
                  run: (async () => ({ meta: { changes: 0 } })) as unknown as D1PreparedStatement["run"],
                });
              }
              return real;
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as typeof env.DB;
    }

    it("answers 404 instead of a stale conflict", async () => {
      const category = await seedCategory();
      const id = await seedPhoto(category.id, approved);

      const response = await directPhotosApp().request(
        `/${id}/selected`,
        { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ selected: true }) },
        { ...env, DB: wrapDb() },
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: "not_found" });
    });
  });
});

describe("ordering the selection", () => {
  it("applies the given order", async () => {
    const category = await seedCategory();
    const a = await seedPhoto(category.id, { ...approved, selected: 1, position: 1 });
    const b = await seedPhoto(category.id, { ...approved, selected: 1, position: 2 });
    await seedPhoto(category.id, approved);
    const response = await api(`/api/categories/${category.id}/selection-order`, { method: "PUT", json: { ids: [b, a] } });
    expect(response.status).toBe(200);
    const { photos } = await json(response);
    expect(photos.filter((p: any) => p.selected).map((p: any) => p.id)).toEqual([b, a]);
  });

  it("refuses ids that are not exactly the selected set", async () => {
    const category = await seedCategory();
    const a = await seedPhoto(category.id, { ...approved, selected: 1, position: 1 });
    const b = await seedPhoto(category.id, { ...approved, selected: 1, position: 2 });
    const unselected = await seedPhoto(category.id, approved);
    for (const ids of [[a], [a, a], [a, b, unselected], [a, "nope"]]) {
      const response = await api(`/api/categories/${category.id}/selection-order`, { method: "PUT", json: { ids } });
      expect(response.status).toBe(400);
      expect((await json(response)).error).toBe("order_mismatch");
    }
  });
});

describe("moving", () => {
  it("moves, deselects, renumbers the old category, and keeps the slug unique", async () => {
    const from = await seedCategory();
    const to = await seedCategory();
    await seedPhoto(to.id, { ...approved, slug: "tiger" });
    const moving = await seedPhoto(from.id, { ...approved, slug: "tiger", selected: 1, position: 1 });
    const staying = await seedPhoto(from.id, { ...approved, slug: "zebra", selected: 1, position: 2 });

    const response = await api(`/api/photos/${moving}/category`, { method: "PUT", json: { categoryId: to.id } });
    expect(await json(response)).toMatchObject({ categoryId: to.id, selected: false, position: 0, slug: "tiger-2" });
    expect(await json(await api(`/api/photos/${staying}`))).toMatchObject({ selected: true, position: 1 });
  });

  it("changes nothing when moved to its own category", async () => {
    const category = await seedCategory();
    const id = await seedPhoto(category.id, { ...approved, slug: "tiger", selected: 1, position: 1 });
    const response = await api(`/api/photos/${id}/category`, { method: "PUT", json: { categoryId: category.id } });
    expect(await json(response)).toMatchObject({ selected: true, position: 1, slug: "tiger" });
  });

  it("returns 404 for an unknown target", async () => {
    const category = await seedCategory();
    const id = await seedPhoto(category.id);
    expect((await api(`/api/photos/${id}/category`, { method: "PUT", json: { categoryId: "nope" } })).status).toBe(404);
  });
});

describe("deleting", () => {
  it("removes the record and every stored file, and renumbers", async () => {
    const category = await seedCategory();
    const id = await seedPhoto(category.id, { ...approved, selected: 1, position: 1 });
    const other = await seedPhoto(category.id, { ...approved, selected: 1, position: 2 });
    await env.BUCKET.put(`derived/hash-${id}/640.avif`, "x");
    await env.BUCKET.put(`derived/hash-${id}/640.jpg`, "x");
    await env.BUCKET.put(`derived/hash-${other}/640.jpg`, "keep");

    expect((await api(`/api/photos/${id}`, { method: "DELETE" })).status).toBe(204);

    expect((await api(`/api/photos/${id}`)).status).toBe(404);
    const keys = (await env.BUCKET.list()).objects.map((object) => object.key).sort();
    expect(keys).toEqual([`derived/hash-${other}/640.jpg`, `originals/${other}`, `previews/${other}.jpg`]);
    expect(await json(await api(`/api/photos/${other}`))).toMatchObject({ selected: true, position: 1 });
  });

  it("returns 404 for an unknown id", async () => {
    expect((await api("/api/photos/nope", { method: "DELETE" })).status).toBe(404);
  });
});

describe("renumbering", () => {
  it("never gives a position to a photograph deselected after the list was read", async () => {
    const category = await seedCategory();
    const kept = await seedPhoto(category.id, { ...approved, selected: 1, position: 2 });
    // Read as selected by the caller, deselected by another request before
    // the renumbering batch runs.
    const deselected = await seedPhoto(category.id, { ...approved, selected: 0, position: 0 });

    await env.DB.batch(renumberStatements(env.DB, [kept, deselected]));

    expect(await json(await api(`/api/photos/${kept}`))).toMatchObject({ selected: true, position: 1 });
    expect(await json(await api(`/api/photos/${deselected}`))).toMatchObject({ selected: false, position: 0 });
  });
});

describe("when another photograph takes the same address at the same moment", () => {
  // The slug read reports no slugs in use, as it would if the other request's
  // write landed between this request's read and its own write; the UNIQUE
  // index then refuses the write.
  function slugReadSeesNothing(): typeof env.DB {
    return new Proxy(env.DB, {
      get(target, prop, receiver) {
        if (prop === "prepare") {
          return (sql: string) => {
            const real = target.prepare(sql);
            if (sql.startsWith("SELECT slug FROM photos WHERE category_id = ?")) {
              return overrideStatement(real, {
                all: (async () => ({ success: true, meta: {}, results: [] })) as unknown as D1PreparedStatement["all"],
              });
            }
            return real;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as typeof env.DB;
  }

  const slugTaken = {
    error: "slug_taken",
    message: "Another photograph in this category already uses that address. Try again.",
  };

  it("approving text answers 409 slug_taken and changes nothing", async () => {
    const category = await seedCategory();
    await seedPhoto(category.id, { ...approved, slug: "tiger" });
    const id = await seedPhoto(category.id);

    const response = await directPhotosApp().request(
      `/${id}/text`,
      { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(text) },
      { ...env, DB: slugReadSeesNothing() },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(slugTaken);
    expect(await json(await api(`/api/photos/${id}`))).toMatchObject({ textStatus: "needs_text", slug: null });
  });

  it("moving answers 409 slug_taken and changes nothing", async () => {
    const from = await seedCategory();
    const to = await seedCategory();
    await seedPhoto(to.id, { ...approved, slug: "tiger" });
    const id = await seedPhoto(from.id, { ...approved, slug: "tiger", selected: 1, position: 1 });

    const response = await directPhotosApp().request(
      `/${id}/category`,
      { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ categoryId: to.id }) },
      { ...env, DB: slugReadSeesNothing() },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(slugTaken);
    expect(await json(await api(`/api/photos/${id}`))).toMatchObject({ categoryId: from.id, slug: "tiger", selected: true, position: 1 });
  });
});

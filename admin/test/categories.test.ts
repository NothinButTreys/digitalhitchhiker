import { env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../src/env";
import { ApiError } from "../src/lib/errors";
import { categories as categoriesApp } from "../src/routes/categories";
import { api, resetDb } from "./helpers";

beforeEach(resetDb);

const valid = { title: "Superstition Mountains", place: "Arizona", description: "Desert east of Phoenix." };

async function create(body: Record<string, unknown> = valid) {
  const response = await api("/api/categories", { method: "POST", json: body });
  return { response, body: (await response.json()) as Record<string, any> };
}

describe("creating a category", () => {
  it("creates it last, with a slug from the title", async () => {
    await create({ ...valid, title: "First" });
    const { response, body } = await create();
    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      slug: "superstition-mountains",
      title: "Superstition Mountains",
      place: "Arizona",
      position: 2,
      hidden: false,
      photoCount: 0,
      selectedCount: 0,
      live: false,
    });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("uses a supplied slug", async () => {
    expect((await create({ ...valid, slug: "superstitions" })).body.slug).toBe("superstitions");
  });

  it("trims text", async () => {
    expect((await create({ title: "  Salt River ", place: " Arizona ", description: " River. " })).body).toMatchObject({
      title: "Salt River",
      place: "Arizona",
      description: "River.",
    });
  });

  it.each([
    [{ ...valid, title: "  " }, "title"],
    [{ ...valid, place: "" }, "place"],
    [{ ...valid, description: "" }, "description"],
    [{ ...valid, title: "x".repeat(61) }, "title"],
    [{ ...valid, slug: "Not A Slug" }, "slug"],
  ])("refuses %j", async (body, field) => {
    const result = await create(body);
    expect(result.response.status).toBe(400);
    expect(result.body.error).toBe("invalid");
    expect(result.body.message).toContain(field);
  });

  it("refuses a slug already in use", async () => {
    await create();
    const again = await create();
    expect(again.response.status).toBe(409);
    expect(again.body.error).toBe("slug_taken");
  });

  it("answers exactly one 201 and one 409, never a 500, when two requests race for the same address", async () => {
    const [first, second] = await Promise.all([create(), create()]);
    const statuses = [first.response.status, second.response.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = first.response.status === 409 ? first : second;
    expect(loser.body.error).toBe("slug_taken");

    const { categories } = (await (await api("/api/categories")).json()) as { categories: any[] };
    expect(categories).toHaveLength(1);
  });

  // categoriesApp has no auth middleware of its own (that is only mounted
  // where it is composed under the top-level app), so it can be called
  // directly with a wrapped DB. It also has no onError of its own — errors
  // only get mapped to the API's JSON error shape by the top-level app's
  // onError, which composition normally supplies — so this wraps it with the
  // same mapping, unchanged from production, purely to make the response
  // observable in isolation.
  function directCategoriesApp() {
    const app = new Hono<AppEnv>();
    app.route("/", categoriesApp);
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
  // override still applies to the bound statement `bind()` returns.
  function overrideStatement(
    statement: D1PreparedStatement,
    overrides: Partial<D1PreparedStatement>,
  ): D1PreparedStatement {
    return new Proxy(statement, {
      get(target, prop, receiver) {
        if (prop === "bind") {
          return (...args: unknown[]) => overrideStatement((target.bind as (...a: unknown[]) => D1PreparedStatement)(...args), overrides);
        }
        if (prop in overrides) return overrides[prop as keyof D1PreparedStatement];
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  function wrapDb(overrides: { slugCheckReturnsNull?: boolean; insertThrows?: Error }): typeof env.DB {
    return new Proxy(env.DB, {
      get(target, prop, receiver) {
        if (prop === "prepare") {
          return (sql: string) => {
            const real = target.prepare(sql);
            if (overrides.slugCheckReturnsNull && sql.startsWith("SELECT 1 FROM categories WHERE slug")) {
              return overrideStatement(real, { first: async () => null });
            }
            if (overrides.insertThrows && sql.startsWith("INSERT INTO categories")) {
              const error = overrides.insertThrows;
              return overrideStatement(real, {
                run: (async () => {
                  throw error;
                }) as D1PreparedStatement["run"],
              });
            }
            return real;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as typeof env.DB;
  }

  it("maps a UNIQUE violation on insert to 409 slug_taken even when the pre-check reported the address as free", async () => {
    const now = "2026-09-29T00:00:00.000Z";
    await env.DB.prepare(
      "INSERT INTO categories (id, slug, title, place, description, position, hidden, created_at, updated_at) VALUES (?, 'taken', 'Taken', 'Arizona', 'Already here.', 1, 0, ?, ?)",
    ).bind("c-taken", now, now).run();

    const response = await directCategoriesApp().request(
      "/",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...valid, slug: "taken" }) },
      { ...env, DB: wrapDb({ slugCheckReturnsNull: true }) },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "slug_taken" });

    const { results } = await env.DB.prepare("SELECT id FROM categories WHERE slug = ?").bind("taken").all();
    expect(results).toHaveLength(1);
  });

  it("propagates an insert failure that is not the slug UNIQUE violation as a 500", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await directCategoriesApp().request(
        "/",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(valid) },
        { ...env, DB: wrapDb({ insertThrows: new Error("D1_ERROR: something else") }) },
      );
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ error: "internal" });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it.each(["colophon", "photos", "assets", "api", "404"])("refuses the reserved slug %s", async (slug) => {
    const result = await create({ ...valid, slug });
    expect(result.response.status).toBe(400);
    expect(result.body.error).toBe("slug_reserved");
  });

  it("refuses a body that is not JSON", async () => {
    const response = await api("/api/categories", { method: "POST", body: "nope", headers: { "content-type": "application/json" } });
    expect(response.status).toBe(400);
  });

  // A cross-site HTML form can send `text/plain` (a "simple" request that
  // needs no preflight) carrying the owner's Access cookie. Refusing any
  // body not declared as JSON closes that door.
  it.each([["text/plain"], ["text/plain;charset=UTF-8"], ["application/x-www-form-urlencoded"], ["multipart/form-data; boundary=x"]])(
    "refuses a JSON body sent as %s with 415 and creates nothing",
    async (contentType) => {
      const response = await api("/api/categories", { method: "POST", body: JSON.stringify(valid), headers: { "content-type": contentType } });
      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({ error: "unsupported_type", message: "Send JSON." });
      expect(((await (await api("/api/categories")).json()) as any).categories).toEqual([]);
    },
  );

  it("refuses a body with no content type with 415", async () => {
    const response = await api("/api/categories", {
      method: "POST",
      body: new TextEncoder().encode(JSON.stringify(valid)),
    });
    expect(response.status).toBe(415);
  });

  it.each([["application/json"], ["application/json; charset=utf-8"], ["Application/JSON;charset=UTF-8"]])(
    "accepts a JSON body sent as %s",
    async (contentType) => {
      const response = await api("/api/categories", { method: "POST", body: JSON.stringify(valid), headers: { "content-type": contentType } });
      expect(response.status).toBe(201);
    },
  );
});

describe("listing categories", () => {
  it("lists in position order with counts and live", async () => {
    const a = (await create({ ...valid, title: "A" })).body;
    const b = (await create({ ...valid, title: "B" })).body;
    const now = "2026-09-29T00:00:00.000Z";
    const insert = (id: string, categoryId: string, selected: number, hash: string) =>
      env.DB.prepare(
        "INSERT INTO photos (id, category_id, text_status, selected, original_key, preview_key, original_name, content_type, content_hash, width, height, source, created_at, updated_at) VALUES (?, ?, 'approved', ?, 'o', 'p', 'n', 'image/jpeg', ?, 1, 1, 'upload', ?, ?)",
      ).bind(id, categoryId, selected, hash, now, now).run();
    await insert("p1", a.id, 1, "h1");
    await insert("p2", a.id, 0, "h2");
    await insert("p3", b.id, 0, "h3");

    const response = await api("/api/categories");
    const { categories } = (await response.json()) as { categories: any[] };
    expect(categories.map((c) => [c.title, c.photoCount, c.selectedCount, c.live])).toEqual([
      ["A", 2, 1, true],
      ["B", 1, 0, false],
    ]);
  });
});

describe("updating a category", () => {
  it("changes title, place, description and hidden, and keeps the slug", async () => {
    const { body } = await create();
    const response = await api(`/api/categories/${body.id}`, {
      method: "PATCH",
      json: { title: "The Superstitions", hidden: true },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      title: "The Superstitions",
      slug: "superstition-mountains",
      place: "Arizona",
      hidden: true,
    });
  });

  it("is not live while hidden even with a selected photograph", async () => {
    const { body } = await create();
    const now = "2026-09-29T00:00:00.000Z";
    await env.DB.prepare(
      "INSERT INTO photos (id, category_id, text_status, selected, original_key, preview_key, original_name, content_type, content_hash, width, height, source, created_at, updated_at) VALUES ('p1', ?, 'approved', 1, 'o', 'p', 'n', 'image/jpeg', 'h1', 1, 1, 'upload', ?, ?)",
    ).bind(body.id, now, now).run();
    const hidden = await api(`/api/categories/${body.id}`, { method: "PATCH", json: { hidden: true } });
    expect(await hidden.json()).toMatchObject({ hidden: true, selectedCount: 1, live: false });
    const shown = await api(`/api/categories/${body.id}`, { method: "PATCH", json: { hidden: false } });
    expect(await shown.json()).toMatchObject({ hidden: false, selectedCount: 1, live: true });
  });

  it("refuses to change the slug", async () => {
    const { body } = await create();
    const response = await api(`/api/categories/${body.id}`, { method: "PATCH", json: { slug: "other" } });
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error).toBe("slug_fixed");
  });

  it("refuses empty text and an unknown id", async () => {
    const { body } = await create();
    expect((await api(`/api/categories/${body.id}`, { method: "PATCH", json: { title: " " } })).status).toBe(400);
    expect((await api("/api/categories/nope", { method: "PATCH", json: { title: "X" } })).status).toBe(404);
  });
});

describe("ordering categories", () => {
  it("renumbers positions in the given order", async () => {
    const a = (await create({ ...valid, title: "A" })).body;
    const b = (await create({ ...valid, title: "B" })).body;
    const c = (await create({ ...valid, title: "C" })).body;
    const response = await api("/api/categories/order", { method: "PUT", json: { ids: [c.id, a.id, b.id] } });
    expect(response.status).toBe(200);
    const { categories } = (await response.json()) as { categories: any[] };
    expect(categories.map((x) => [x.title, x.position])).toEqual([["C", 1], ["A", 2], ["B", 3]]);
  });

  it.each([
    ["a missing id", (ids: string[]) => ids.slice(1)],
    ["a repeated id", (ids: string[]) => [ids[0]!, ids[0]!]],
    ["an unknown id", (ids: string[]) => [...ids.slice(1), "nope"]],
  ])("refuses %s", async (_name, change) => {
    const a = (await create({ ...valid, title: "A" })).body;
    const b = (await create({ ...valid, title: "B" })).body;
    const response = await api("/api/categories/order", { method: "PUT", json: { ids: change([a.id, b.id]) } });
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error).toBe("order_mismatch");
  });
});

describe("deleting a category", () => {
  it("deletes an empty category", async () => {
    const { body } = await create();
    expect((await api(`/api/categories/${body.id}`, { method: "DELETE" })).status).toBe(204);
    expect(((await (await api("/api/categories")).json()) as any).categories).toEqual([]);
  });

  it("refuses when it holds photographs", async () => {
    const { body } = await create();
    const now = "2026-09-29T00:00:00.000Z";
    await env.DB.prepare(
      "INSERT INTO photos (id, category_id, text_status, original_key, preview_key, original_name, content_type, content_hash, width, height, source, created_at, updated_at) VALUES ('p1', ?, 'needs_text', 'o', 'p', 'n', 'image/jpeg', 'h1', 1, 1, 'upload', ?, ?)",
    ).bind(body.id, now, now).run();
    const response = await api(`/api/categories/${body.id}`, { method: "DELETE" });
    expect(response.status).toBe(409);
    expect(((await response.json()) as any).error).toBe("category_not_empty");
  });

  it("returns 404 for an unknown id", async () => {
    expect((await api("/api/categories/nope", { method: "DELETE" })).status).toBe(404);
  });

  it("deletes an empty category that still has a pending upload, with the upload's row and files", async () => {
    const { body } = await create();
    const declared = await api("/api/uploads", {
      method: "POST",
      json: {
        categoryId: body.id,
        originalName: "IMG_0001.JPG",
        contentType: "image/jpeg",
        contentHash: "a".repeat(64),
        size: 5,
        width: 6000,
        height: 4000,
      },
    });
    expect(declared.status).toBe(201);
    const { id } = (await declared.json()) as { id: string };
    await env.BUCKET.put(`originals/${id}`, "bytes");
    await env.BUCKET.put(`previews/${id}.jpg`, "preview");

    expect((await api(`/api/categories/${body.id}`, { method: "DELETE" })).status).toBe(204);

    expect(((await (await api("/api/categories")).json()) as any).categories).toEqual([]);
    expect((await env.DB.prepare("SELECT id FROM uploads").all()).results).toEqual([]);
    expect((await env.BUCKET.list()).objects).toEqual([]);
  });
});

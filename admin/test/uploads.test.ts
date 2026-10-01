import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppEnv } from "../src/env";
import { removeUpload } from "../src/db/uploads";
import { ApiError } from "../src/lib/errors";
import { cleanUpStaleUploads, uploads as uploadsApp } from "../src/routes/uploads";
import { api, approved, resetDb, seedCategory, seedPhoto } from "./helpers";

beforeEach(resetDb);

const json = async (response: Response) => (await response.json()) as any;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const ORIGINAL = "pretend these are the bytes of a photograph";
const PREVIEW = "pretend preview";

async function declare(categoryId: string, overrides: Record<string, unknown> = {}) {
  return api("/api/uploads", {
    method: "POST",
    json: {
      categoryId,
      originalName: "IMG_0001.JPG",
      contentType: "image/jpeg",
      contentHash: await sha256(ORIGINAL),
      size: ORIGINAL.length,
      width: 6000,
      height: 4000,
      ...overrides,
    },
  });
}

const putOriginal = (id: string, body = ORIGINAL, length = String(body.length)) =>
  api(`/api/uploads/${id}/original`, { method: "PUT", body, headers: { "content-type": "image/jpeg", "content-length": length } });
const putPreview = (id: string, body = PREVIEW, type = "image/jpeg", length = String(body.length)) =>
  api(`/api/uploads/${id}/preview`, { method: "PUT", body, headers: { "content-type": type, "content-length": length } });

// uploadsApp has no auth middleware of its own (only mounted where it is
// composed under the top-level app), so it can be called directly with a
// wrapped DB. It also has no onError of its own, so this wraps it with the
// same error mapping the top-level app supplies in production, purely to
// make the response observable in isolation. Same pattern as
// categories.test.ts's directCategoriesApp / photos.test.ts's directPhotosApp.
function directUploadsApp() {
  const app = new Hono<AppEnv>();
  app.route("/", uploadsApp);
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
function overrideStatement(statement: D1PreparedStatement, overrides: Partial<D1PreparedStatement>): D1PreparedStatement {
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

// Returns env.DB with `prepare` routed through `route`: whatever `route`
// returns for a given SQL string replaces the real statement; `undefined`
// keeps the real one.
function routeDb(route: (sql: string, real: D1PreparedStatement) => D1PreparedStatement | undefined): typeof env.DB {
  return new Proxy(env.DB, {
    get(target, prop, receiver) {
      if (prop === "prepare") {
        return (sql: string) => {
          const real = target.prepare(sql);
          return route(sql, real) ?? real;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as typeof env.DB;
}

// A statement whose `run()` reports zero rows changed, regardless of what the
// real statement would have done.
const reportsNoChange = (real: D1PreparedStatement) =>
  overrideStatement(real, {
    run: (async () => ({ success: true, meta: { changes: 0 }, results: [] })) as unknown as D1PreparedStatement["run"],
  });

describe("declaring an upload", () => {
  it("creates a pending upload", async () => {
    const category = await seedCategory();
    const response = await declare(category.id);
    expect(response.status).toBe(201);
    expect((await json(response)).id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses an unknown category", async () => {
    expect((await declare("nope")).status).toBe(404);
  });

  it.each([
    [{ contentType: "image/gif" }, 415, "unsupported_type"],
    [{ contentType: "application/pdf" }, 415, "unsupported_type"],
    [{ size: 62_914_561 }, 413, "too_large"],
    [{ size: 0 }, 400, "invalid"],
    [{ contentHash: "abc" }, 400, "invalid"],
    [{ contentHash: "G".repeat(64) }, 400, "invalid"],
    [{ width: 0 }, 400, "invalid"],
    [{ height: -1 }, 400, "invalid"],
    [{ originalName: " " }, 400, "invalid"],
  ])("refuses %j", async (overrides, status, code) => {
    const category = await seedCategory();
    const response = await declare(category.id, overrides);
    expect(response.status).toBe(status);
    expect((await json(response)).error).toBe(code);
  });

  it.each(["image/jpeg", "image/png", "image/heic", "image/heif"])("accepts %s", async (contentType) => {
    const category = await seedCategory();
    expect((await declare(category.id, { contentType })).status).toBe(201);
  });

  it("refuses a file already in the library and names it", async () => {
    const category = await seedCategory();
    const existing = await seedPhoto(category.id, { ...approved, title: "Tiger" });
    const response = await declare(category.id, { contentHash: `hash-${existing}`.padEnd(64, "0").replace(/[^0-9a-f]/g, "a") });
    expect(response.status).toBe(201);

    await env.DB.prepare("UPDATE photos SET content_hash = ? WHERE id = ?").bind(await sha256(ORIGINAL), existing).run();
    const duplicate = await declare(category.id);
    expect(duplicate.status).toBe(409);
    expect(await json(duplicate)).toMatchObject({ error: "duplicate", photoId: existing, title: "Tiger" });
  });

  it("replaces a pending upload of the same file", async () => {
    const category = await seedCategory();
    const first = (await json(await declare(category.id))).id;
    await putOriginal(first);
    const second = (await json(await declare(category.id))).id;
    expect(second).not.toBe(first);
    expect(await env.BUCKET.head(`originals/${first}`)).toBeNull();
    expect((await api(`/api/uploads/${first}/complete`, { method: "POST" })).status).toBe(404);
  });

  it("keeps only the file name from a path", async () => {
    const category = await seedCategory();
    const { id } = await json(await declare(category.id, { originalName: "C:\\Users\\someone\\Pictures\\river.jpg" }));
    await putOriginal(id);
    await putPreview(id);
    expect((await json(await api(`/api/uploads/${id}/complete`, { method: "POST" }))).originalName).toBe("river.jpg");
  });

  it("declares the same new file twice at once without a 500, leaving exactly one pending upload", async () => {
    const category = await seedCategory();
    const [first, second] = await Promise.all([declare(category.id), declare(category.id)]);
    expect(first.status).not.toBe(500);
    expect(second.status).not.toBe(500);
    const successes = [first, second].filter((response) => response.status === 201);
    expect(successes.length).toBeGreaterThanOrEqual(1);
    for (const response of successes) {
      expect((await json(response)).id).toMatch(/^[0-9a-f-]{36}$/);
    }

    const contentHash = await sha256(ORIGINAL);
    const rows = await env.DB.prepare("SELECT id FROM uploads WHERE content_hash = ?").bind(contentHash).all<{ id: string }>();
    expect(rows.results).toHaveLength(1);

    const survivorId = rows.results[0]!.id;
    await putOriginal(survivorId);
    await putPreview(survivorId);
    expect((await api(`/api/uploads/${survivorId}/complete`, { method: "POST" })).status).toBe(201);
    const photoCount = await env.DB.prepare("SELECT COUNT(*) as count FROM photos").first<{ count: number }>();
    expect(photoCount!.count).toBe(1);
  });

  // Makes every `INSERT INTO uploads` fail with `insertThrows` for the first
  // `failCount` attempts (default: every attempt), then delegate to the real
  // statement — simulating a UNIQUE violation on content_hash without needing
  // an actual second declarer to race against.
  function wrapDb(insertThrows: Error, failCount = Infinity): typeof env.DB {
    let calls = 0;
    return new Proxy(env.DB, {
      get(target, prop, receiver) {
        if (prop === "prepare") {
          return (sql: string) => {
            const real = target.prepare(sql);
            if (sql.startsWith("INSERT INTO uploads")) {
              calls += 1;
              if (calls <= failCount) {
                return overrideStatement(real, {
                  run: (async () => {
                    throw insertThrows;
                  }) as D1PreparedStatement["run"],
                });
              }
            }
            return real;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as typeof env.DB;
  }

  async function declareBody(categoryId: string) {
    return {
      categoryId,
      originalName: "IMG_0001.JPG",
      contentType: "image/jpeg",
      contentHash: await sha256(ORIGINAL),
      size: ORIGINAL.length,
      width: 6000,
      height: 4000,
    };
  }

  it("retries once after a UNIQUE violation on content_hash and succeeds", async () => {
    const category = await seedCategory();
    const response = await directUploadsApp().request(
      "/",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(await declareBody(category.id)) },
      { ...env, DB: wrapDb(new Error("D1_ERROR: UNIQUE constraint failed: uploads.content_hash"), 1) },
    );
    expect(response.status).toBe(201);
    expect(((await response.json()) as any).id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("answers 409 upload_in_progress when the insert still fails after the retry", async () => {
    const category = await seedCategory();
    const response = await directUploadsApp().request(
      "/",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(await declareBody(category.id)) },
      { ...env, DB: wrapDb(new Error("D1_ERROR: UNIQUE constraint failed: uploads.content_hash")) },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "upload_in_progress",
      message: "This photograph is already being uploaded. Try again in a moment.",
    });
  });
});

describe("sending the files", () => {
  it("stores the original and the preview", async () => {
    const category = await seedCategory();
    const { id } = await json(await declare(category.id));
    expect((await putOriginal(id)).status).toBe(204);
    expect((await putPreview(id)).status).toBe(204);
    const original = await env.BUCKET.get(`originals/${id}`);
    expect(await original!.text()).toBe(ORIGINAL);
    expect(original!.httpMetadata?.contentType).toBe("image/jpeg");
    expect(await (await env.BUCKET.get(`previews/${id}.jpg`))!.text()).toBe(PREVIEW);
  });

  it("refuses an original whose length differs from the declared size", async () => {
    const category = await seedCategory();
    const { id } = await json(await declare(category.id));
    const response = await putOriginal(id, "short");
    expect(response.status).toBe(400);
    expect((await json(response)).error).toBe("size_mismatch");
    expect(await env.BUCKET.head(`originals/${id}`)).toBeNull();
  });

  it("refuses an original whose bytes do not match the declared hash", async () => {
    const category = await seedCategory();
    const tampered = ORIGINAL.replace("pretend", "PRETEND");
    const { id } = await json(await declare(category.id));
    const response = await putOriginal(id, tampered);
    expect(response.status).toBe(400);
    expect((await json(response)).error).toBe("hash_mismatch");
    expect(await env.BUCKET.head(`originals/${id}`)).toBeNull();
  });

  it("refuses a preview that is not JPEG or is too large", async () => {
    const category = await seedCategory();
    const { id } = await json(await declare(category.id));
    expect((await putPreview(id, PREVIEW, "image/png")).status).toBe(415);
    expect((await putPreview(id, "x", "image/jpeg", "2097153")).status).toBe(413);
  });

  // The pool's own fetch honors a `content-length` header that disagrees with
  // the body actually sent — this was confirmed by hand before writing this
  // test (see the report) — so declaring a length longer than the real body
  // reliably reproduces a truncated upload (a dropped connection) at the
  // Worker, without any interception on the client side.
  it("refuses a preview whose body does not match its declared length, leaving the upload pending for a retry", async () => {
    const category = await seedCategory();
    const { id } = await json(await declare(category.id));
    const response = await putPreview(id, PREVIEW, "image/jpeg", String(PREVIEW.length + 10));
    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({
      error: "size_mismatch",
      message: "The preview's size differs from the size that was declared.",
    });
    expect(await env.BUCKET.head(`previews/${id}.jpg`)).toBeNull();

    // The upload is still pending, has_preview untouched: completing now still
    // reports it incomplete rather than 500ing or silently accepting nothing.
    await putOriginal(id);
    const tooSoon = await api(`/api/uploads/${id}/complete`, { method: "POST" });
    expect(tooSoon.status).toBe(409);
    expect((await json(tooSoon)).error).toBe("upload_incomplete");

    // A later, correct preview for the same upload then succeeds.
    expect((await putPreview(id)).status).toBe(204);
    const complete = await api(`/api/uploads/${id}/complete`, { method: "POST" });
    expect(complete.status).toBe(201);
  });

  it("returns 404 for an unknown upload", async () => {
    expect((await putOriginal("nope")).status).toBe(404);
    expect((await putPreview("nope")).status).toBe(404);
  });

  it("a failed send never deletes a file an earlier send already stored", async () => {
    const category = await seedCategory();
    const { id } = await json(await declare(category.id));
    expect((await putOriginal(id)).status).toBe(204);

    // A second, mismatched send for the same upload id fails, but the first
    // send's bytes are still there — a rejected R2 put stores nothing, so
    // there is nothing here for this failed send to have overwritten.
    const mismatched = await putOriginal(id, "short");
    expect(mismatched.status).toBe(400);
    expect((await json(mismatched)).error).toBe("size_mismatch");
    expect(await (await env.BUCKET.get(`originals/${id}`))!.text()).toBe(ORIGINAL);

    // The file is now unverified, though: has_original is 0 until a correct
    // resend restores it, so `complete` can't build a photograph out of it.
    const afterFailure = await env.DB.prepare("SELECT has_original FROM uploads WHERE id = ?").bind(id).first<{ has_original: number }>();
    expect(afterFailure!.has_original).toBe(0);

    // A third, correct send recovers it, and completing then works.
    expect((await putOriginal(id)).status).toBe(204);
    await putPreview(id);
    const complete = await api(`/api/uploads/${id}/complete`, { method: "POST" });
    expect(complete.status).toBe(201);
  });

  it("a failed preview send never deletes a preview an earlier send already stored", async () => {
    const category = await seedCategory();
    const { id } = await json(await declare(category.id));
    expect((await putPreview(id)).status).toBe(204);

    const mismatched = await putPreview(id, PREVIEW, "image/jpeg", String(PREVIEW.length + 10));
    expect(mismatched.status).toBe(400);
    expect(await (await env.BUCKET.get(`previews/${id}.jpg`))!.text()).toBe(PREVIEW);

    const afterFailure = await env.DB.prepare("SELECT has_preview FROM uploads WHERE id = ?").bind(id).first<{ has_preview: number }>();
    expect(afterFailure!.has_preview).toBe(0);

    expect((await putPreview(id)).status).toBe(204);
    await putOriginal(id);
    const complete = await api(`/api/uploads/${id}/complete`, { method: "POST" });
    expect(complete.status).toBe(201);
  });

  it("deletes nothing on a failed send when the unclaiming update reports no change", async () => {
    const category = await seedCategory();
    const { id } = await json(await declare(category.id));
    await env.BUCKET.put(`originals/${id}`, "marker-bytes");

    // Simulate the row already being claimed by something else at the moment
    // of failure (the same "zero rows changed" case that a genuinely removed
    // row produces): the conditional unclaim UPDATE reports no change, and
    // the marker object already at the key must survive untouched.
    const db = routeDb((sql, real) =>
      sql === "UPDATE uploads SET has_original = 0 WHERE id = ? AND has_original = 0" ? reportsNoChange(real) : undefined,
    );
    const ctx = createExecutionContext();
    const response = await directUploadsApp().request(
      `/${id}/original`,
      { method: "PUT", body: "short", headers: { "content-type": "image/jpeg", "content-length": "5" } },
      { ...env, DB: db },
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(400);
    expect(await (await env.BUCKET.get(`originals/${id}`))!.text()).toBe("marker-bytes");
  });
});

describe("completing an upload", () => {
  it("creates the photograph awaiting its text", async () => {
    const category = await seedCategory();
    const { id } = await json(await declare(category.id));
    await putOriginal(id);
    await putPreview(id);
    const response = await api(`/api/uploads/${id}/complete`, { method: "POST" });
    expect(response.status).toBe(201);
    expect(await json(response)).toMatchObject({
      id,
      categoryId: category.id,
      slug: null,
      title: "",
      textStatus: "needs_text",
      selected: false,
      originalName: "IMG_0001.JPG",
      width: 6000,
      height: 4000,
      source: "upload",
      previewUrl: `/api/photos/${id}/preview`,
    });
    expect((await api(`/api/uploads/${id}/complete`, { method: "POST" })).status).toBe(404);
  });

  it.each([
    ["nothing", false, false],
    ["only the original", true, false],
    ["only the preview", false, true],
  ])("refuses when %s was sent", async (_name, original, preview) => {
    const category = await seedCategory();
    const { id } = await json(await declare(category.id));
    if (original) await putOriginal(id);
    if (preview) await putPreview(id);
    const response = await api(`/api/uploads/${id}/complete`, { method: "POST" });
    expect(response.status).toBe(409);
    expect((await json(response)).error).toBe("upload_incomplete");
  });

  it("refuses the same file a second time once it is in the library", async () => {
    const category = await seedCategory();
    const { id } = await json(await declare(category.id));
    await putOriginal(id);
    await putPreview(id);
    await api(`/api/uploads/${id}/complete`, { method: "POST" });
    const again = await declare(category.id);
    expect(again.status).toBe(409);
    expect((await json(again)).photoId).toBe(id);
  });

  it("creates exactly one photograph when completed twice at once", async () => {
    const category = await seedCategory();
    const { id } = await json(await declare(category.id));
    await putOriginal(id);
    await putPreview(id);

    const [first, second] = await Promise.all([
      api(`/api/uploads/${id}/complete`, { method: "POST" }),
      api(`/api/uploads/${id}/complete`, { method: "POST" }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 404]);
    const rows = await env.DB.prepare("SELECT id FROM photos WHERE id = ?").bind(id).all();
    expect(rows.results.length).toBe(1);
  });
});

describe("cleaning up", () => {
  it("removes pending uploads older than a day and their files, and nothing else", async () => {
    const category = await seedCategory();
    const stale = (await json(await declare(category.id))).id;
    await putOriginal(stale);
    await putPreview(stale);
    const fresh = (await json(await declare(category.id, { contentHash: await sha256("other"), size: 5 }))).id;
    const kept = await seedPhoto(category.id);
    await env.DB.prepare("UPDATE uploads SET created_at = ? WHERE id = ?").bind("2026-09-27T00:00:00.000Z", stale).run();
    await env.DB.prepare("UPDATE uploads SET created_at = ? WHERE id = ?").bind("2026-09-28T12:00:00.000Z", fresh).run();

    const removed = await cleanUpStaleUploads(env, new Date("2026-09-29T00:00:00.000Z"));

    expect(removed).toBe(1);
    const ids = (await env.DB.prepare("SELECT id FROM uploads").all<{ id: string }>()).results.map((row) => row.id);
    expect(ids).toEqual([fresh]);
    const keys = (await env.BUCKET.list()).objects.map((object) => object.key).sort();
    expect(keys).toEqual([`originals/${kept}`, `previews/${kept}.jpg`]);
  });
});

describe("when a pending upload is removed underneath a request", () => {
  // A statement whose bound `first()` reads the real row and then runs
  // `after` before returning it: the read succeeds, and the world changes
  // immediately afterwards, before the caller's next statement.
  function thenAfterFirst(statement: D1PreparedStatement, after: () => Promise<unknown>): D1PreparedStatement {
    return new Proxy(statement, {
      get(target, prop, receiver) {
        if (prop === "bind") {
          return (...args: unknown[]) => {
            const bound = (target.bind as (...a: unknown[]) => D1PreparedStatement)(...args);
            return new Proxy(bound, {
              get(boundTarget, boundProp, boundReceiver) {
                if (boundProp === "first") {
                  return async () => {
                    const row = await boundTarget.first();
                    await after();
                    return row;
                  };
                }
                return Reflect.get(boundTarget, boundProp, boundReceiver);
              },
            });
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  it("removeUpload deletes no file and answers false when the row is already gone", async () => {
    await env.BUCKET.put("originals/gone", "original-bytes");
    await env.BUCKET.put("previews/gone.jpg", "preview-bytes");

    expect(await removeUpload(env.DB, env.BUCKET, "gone")).toBe(false);

    expect(await env.BUCKET.head("originals/gone")).not.toBeNull();
    expect(await env.BUCKET.head("previews/gone.jpg")).not.toBeNull();
  });

  it("removeUpload deletes the row and then the files, and answers true", async () => {
    const category = await seedCategory();
    const { id } = await json(await declare(category.id));
    await putOriginal(id);
    await putPreview(id);

    expect(await removeUpload(env.DB, env.BUCKET, id)).toBe(true);

    expect(await env.DB.prepare("SELECT id FROM uploads WHERE id = ?").bind(id).first()).toBeNull();
    expect(await env.BUCKET.head(`originals/${id}`)).toBeNull();
    expect(await env.BUCKET.head(`previews/${id}.jpg`)).toBeNull();
  });

  it("complete answers 404, creates no photograph, and leaves the files to whoever removed the row", async () => {
    const category = await seedCategory();
    const { id } = await json(await declare(category.id));
    await putOriginal(id);
    await putPreview(id);

    // The row passes complete's own check, then disappears (as the nightly
    // cleanup's row delete would) before complete's batch runs. The files are
    // still there: the remover deletes them only after its row delete.
    const db = routeDb((sql, real) =>
      sql.startsWith("SELECT * FROM uploads WHERE id = ?")
        ? thenAfterFirst(real, () => env.DB.prepare("DELETE FROM uploads WHERE id = ?").bind(id).run())
        : undefined,
    );
    const response = await directUploadsApp().request(`/${id}/complete`, { method: "POST" }, { ...env, DB: db });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "not_found", message: "No such upload." });
    expect(await env.DB.prepare("SELECT id FROM photos WHERE id = ?").bind(id).first()).toBeNull();
    expect(await env.BUCKET.head(`originals/${id}`)).not.toBeNull();
    expect(await env.BUCKET.head(`previews/${id}.jpg`)).not.toBeNull();
  });

  it("an original stored after its row was removed is deleted again, with a 404", async () => {
    const category = await seedCategory();
    const { id } = await json(await declare(category.id));

    const db = routeDb((sql, real) => (sql.startsWith("UPDATE uploads SET has_original") ? reportsNoChange(real) : undefined));
    const ctx = createExecutionContext();
    const response = await directUploadsApp().request(
      `/${id}/original`,
      { method: "PUT", body: ORIGINAL, headers: { "content-type": "image/jpeg", "content-length": String(ORIGINAL.length) } },
      { ...env, DB: db },
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "not_found", message: "No such upload." });
    expect(await env.BUCKET.head(`originals/${id}`)).toBeNull();
  });

  it("a file stored after the upload was completed is left in place for the photograph, with a 404", async () => {
    const category = await seedCategory();
    const { id } = await json(await declare(category.id));
    await putOriginal(id);
    await putPreview(id);
    const staleRow = await env.DB.prepare("SELECT * FROM uploads WHERE id = ?").bind(id).first();
    expect((await api(`/api/uploads/${id}/complete`, { method: "POST" })).status).toBe(201);

    // A late, repeated send of the original passes its row check against the
    // row as it was before completion, and lands after `complete` removed it:
    // the key now holds the photograph's original, which must survive.
    const db = routeDb((sql, real) =>
      sql.startsWith("SELECT * FROM uploads WHERE id = ?")
        ? overrideStatement(real, { first: (async () => staleRow) as D1PreparedStatement["first"] })
        : undefined,
    );
    const ctx = createExecutionContext();
    const response = await directUploadsApp().request(
      `/${id}/original`,
      { method: "PUT", body: ORIGINAL, headers: { "content-type": "image/jpeg", "content-length": String(ORIGINAL.length) } },
      { ...env, DB: db },
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(404);
    expect(await (await env.BUCKET.get(`originals/${id}`))!.text()).toBe(ORIGINAL);
    expect(await env.BUCKET.head(`previews/${id}.jpg`)).not.toBeNull();
  });

  it("a preview stored after its row was removed is deleted again, with a 404", async () => {
    const category = await seedCategory();
    const { id } = await json(await declare(category.id));

    const db = routeDb((sql, real) => (sql.startsWith("UPDATE uploads SET has_preview") ? reportsNoChange(real) : undefined));
    const ctx = createExecutionContext();
    const response = await directUploadsApp().request(
      `/${id}/preview`,
      { method: "PUT", body: PREVIEW, headers: { "content-type": "image/jpeg", "content-length": String(PREVIEW.length) } },
      { ...env, DB: db },
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "not_found", message: "No such upload." });
    expect(await env.BUCKET.head(`previews/${id}.jpg`)).toBeNull();
  });
});

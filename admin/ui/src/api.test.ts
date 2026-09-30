import { describe, expect, it, vi } from "vitest";
import { ApiRequestError, createApi } from "./api";

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("api client", () => {
  it("lists categories", async () => {
    const fetchImpl = fakeFetch(200, { categories: [{ id: "c1", title: "A" }] });
    const api = createApi(fetchImpl);
    expect(await api.listCategories()).toEqual([{ id: "c1", title: "A" }]);
    expect(fetchImpl.mock.calls[0]![0]).toBe("/api/categories");
  });

  it("sends JSON bodies", async () => {
    const fetchImpl = fakeFetch(201, { id: "c1" });
    const api = createApi(fetchImpl);
    await api.createCategory({ title: "A", place: "P", description: "D" });
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ title: "A", place: "P", description: "D" });
  });

  it("sends the dev email header only when one is given", async () => {
    const withEmail = fakeFetch(200, { categories: [] });
    await createApi(withEmail, "owner@example.com").listCategories();
    expect(new Headers(withEmail.mock.calls[0]![1]!.headers).get("x-dev-email")).toBe("owner@example.com");

    const without = fakeFetch(200, { categories: [] });
    await createApi(without).listCategories();
    expect(new Headers(without.mock.calls[0]![1]!.headers).has("x-dev-email")).toBe(false);
  });

  it("throws the API's error with its code, message, and details", async () => {
    const api = createApi(
      fakeFetch(409, { error: "duplicate", message: "Already in the library.", photoId: "p1" }),
    );
    const failure = await api.listCategories().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiRequestError);
    expect(failure).toMatchObject({ status: 409, code: "duplicate", message: "Already in the library.", details: { photoId: "p1" } });
  });

  it("throws a readable error when the reply is not JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>gateway</html>", { status: 502 }));
    const failure = await createApi(fetchImpl).listCategories().catch((error: unknown) => error);
    expect(failure).toMatchObject({ status: 502, code: "unexpected", message: "The library did not answer properly. Try again." });
  });

  it("throws a readable error when the network fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const failure = await createApi(fetchImpl).listCategories().catch((error: unknown) => error);
    expect(failure).toMatchObject({ status: 0, code: "network", message: "Could not reach the library. Check your connection." });
  });

  it("returns nothing for a 204", async () => {
    const api = createApi(fakeFetch(204, undefined));
    expect(await api.deleteCategory("c1")).toBeUndefined();
  });

  it("requests with redirect: manual and credentials: same-origin", async () => {
    const fetchImpl = fakeFetch(200, { categories: [] });
    await createApi(fetchImpl).listCategories();
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.redirect).toBe("manual");
    expect(init.credentials).toBe("same-origin");
  });

  const SIGNED_OUT_MESSAGE = "You have been signed out. Reload the page to sign in again.";

  it("treats an opaque redirect as being signed out", async () => {
    const fetchImpl = vi.fn(
      async () =>
        ({ type: "opaqueredirect", status: 0, ok: false, headers: new Headers() }) as unknown as Response,
    );
    const failure = await createApi(fetchImpl).listCategories().catch((error: unknown) => error);
    expect(failure).toMatchObject({ status: 401, code: "signed_out", message: SIGNED_OUT_MESSAGE });
  });

  it("treats a redirect status as being signed out", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302 }));
    const failure = await createApi(fetchImpl).listCategories().catch((error: unknown) => error);
    expect(failure).toMatchObject({ status: 401, code: "signed_out", message: SIGNED_OUT_MESSAGE });
  });

  it.each([401, 403])("treats a %s with a non-JSON body as being signed out", async (status) => {
    const fetchImpl = vi.fn(async () => new Response("<html>Sign in with your organization</html>", { status }));
    const failure = await createApi(fetchImpl).listCategories().catch((error: unknown) => error);
    expect(failure).toMatchObject({ status: 401, code: "signed_out", message: SIGNED_OUT_MESSAGE });
  });

  it("treats a 200 HTML reply as being signed out", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("<html>Sign in</html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
    );
    const failure = await createApi(fetchImpl).listCategories().catch((error: unknown) => error);
    expect(failure).toMatchObject({ status: 401, code: "signed_out", message: SIGNED_OUT_MESSAGE });
  });

  it("treats a JSON unauthorized error as being signed out", async () => {
    const fetchImpl = fakeFetch(401, { error: "unauthorized", message: "Nope." });
    const failure = await createApi(fetchImpl).listCategories().catch((error: unknown) => error);
    expect(failure).toMatchObject({ status: 401, code: "signed_out", message: SIGNED_OUT_MESSAGE });
  });

  it("keeps a JSON 403 forbidden error from the Worker as forbidden", async () => {
    const fetchImpl = fakeFetch(403, { error: "forbidden", message: "You cannot do that." });
    const failure = await createApi(fetchImpl).listCategories().catch((error: unknown) => error);
    expect(failure).toMatchObject({ status: 403, code: "forbidden", message: "You cannot do that." });
  });

  it("uploads in four steps", async () => {
    const calls: [string, RequestInit][] = [];
    const replies = [
      new Response(JSON.stringify({ id: "u1" }), { status: 201 }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      new Response(JSON.stringify({ id: "u1", textStatus: "needs_text" }), { status: 201 }),
    ];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([String(input), init!]);
      return replies.shift()!;
    });
    const file = new File(["abc"], "river.jpg", { type: "image/jpeg" });
    const preview = new Blob(["p"], { type: "image/jpeg" });
    const photo = await createApi(fetchImpl as unknown as typeof fetch).upload("zoo", {
      file,
      contentType: "image/jpeg",
      contentHash: "h".repeat(64),
      width: 6000,
      height: 4000,
      preview,
    });

    expect(photo).toEqual({ id: "u1", textStatus: "needs_text" });
    expect(calls.map(([path, init]) => [init.method, path])).toEqual([
      ["POST", "/api/uploads"],
      ["PUT", "/api/uploads/u1/original"],
      ["PUT", "/api/uploads/u1/preview"],
      ["POST", "/api/uploads/u1/complete"],
    ]);
    expect(JSON.parse(calls[0]![1].body as string)).toEqual({
      categoryId: "zoo",
      originalName: "river.jpg",
      contentType: "image/jpeg",
      contentHash: "h".repeat(64),
      size: 3,
      width: 6000,
      height: 4000,
    });
    expect(calls[1]![1].body).toBe(file);
    expect(calls[2]![1].body).toBe(preview);
    expect(new Headers(calls[2]![1].headers).get("content-type")).toBe("image/jpeg");
  });

  it.each(["size_mismatch", "hash_mismatch"])(
    "retries the whole upload once from the start after a %s, and succeeds",
    async (code) => {
      const calls: string[] = [];
      const replies = [
        new Response(JSON.stringify({ id: "u1" }), { status: 201 }), // 1st declare
        new Response(JSON.stringify({ error: code, message: "damaged" }), { status: 400 }), // 1st original PUT fails
        new Response(JSON.stringify({ id: "u2" }), { status: 201 }), // 2nd declare
        new Response(null, { status: 204 }), // 2nd original PUT
        new Response(null, { status: 204 }), // 2nd preview PUT
        new Response(JSON.stringify({ id: "u2", textStatus: "needs_text" }), { status: 201 }), // 2nd complete
      ];
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return replies.shift()!;
      });
      const file = new File(["abc"], "river.jpg", { type: "image/jpeg" });
      const photo = await createApi(fetchImpl as unknown as typeof fetch).upload("zoo", {
        file,
        contentType: "image/jpeg",
        contentHash: "h".repeat(64),
        width: 6000,
        height: 4000,
        preview: new Blob(["p"], { type: "image/jpeg" }),
      });
      expect(photo).toEqual({ id: "u2", textStatus: "needs_text" });
      expect(calls).toEqual([
        "/api/uploads",
        "/api/uploads/u1/original",
        "/api/uploads",
        "/api/uploads/u2/original",
        "/api/uploads/u2/preview",
        "/api/uploads/u2/complete",
      ]);
    },
  );

  it("gives up and reports the failure when the retry also fails", async () => {
    const replies = [
      new Response(JSON.stringify({ id: "u1" }), { status: 201 }),
      new Response(JSON.stringify({ error: "hash_mismatch", message: "The file that arrived is not the file that was declared. Try again." }), { status: 400 }),
      new Response(JSON.stringify({ id: "u2" }), { status: 201 }),
      new Response(JSON.stringify({ error: "hash_mismatch", message: "The file that arrived is not the file that was declared. Try again." }), { status: 400 }),
    ];
    const fetchImpl = vi.fn(async () => replies.shift()!);
    const file = new File(["abc"], "river.jpg", { type: "image/jpeg" });
    const failure = await createApi(fetchImpl as unknown as typeof fetch)
      .upload("zoo", {
        file,
        contentType: "image/jpeg",
        contentHash: "h".repeat(64),
        width: 6000,
        height: 4000,
        preview: new Blob(["p"], { type: "image/jpeg" }),
      })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ status: 400, code: "hash_mismatch" });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("asks for the publish state and starts a publish", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const api = createApi(fetchImpl);
    await api.publishState();
    await api.startPublish("preview");
    expect(calls[0]![0]).toBe("/api/publishes/state");
    expect(calls[1]![0]).toBe("/api/publishes");
    expect(calls[1]![1].method).toBe("POST");
    expect(JSON.parse(calls[1]![1].body as string)).toEqual({ target: "preview" });
  });
});

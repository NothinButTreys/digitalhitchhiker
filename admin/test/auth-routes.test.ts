import { describe, expect, it } from "vitest";
import { api } from "./helpers";

describe("identity on routes", () => {
  it("returns the owner from /api/me", async () => {
    const response = await api("/api/me");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "owner", email: "owner@example.com" });
  });

  it("refuses a request with no identity and returns no data", async () => {
    const response = await api("/api/me", { as: null });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized", message: "Sign in to continue." });
  });

  it("refuses another email", async () => {
    expect((await api("/api/me", { as: "someone@example.com" })).status).toBe(401);
  });

  it("refuses before reporting that a route does not exist", async () => {
    expect((await api("/api/nope", { as: null })).status).toBe(401);
  });

  it("leaves the health check open", async () => {
    expect((await api("/api/health", { as: null })).status).toBe(200);
  });
});

describe("requests the Worker does not serve", () => {
  const notFound = { error: "not_found", message: "No such route." };

  it.each([
    ["GET /anything", () => api("/anything")],
    ["POST /upload", () => api("/upload", { method: "POST" })],
    ["GET /API/me", () => api("/API/me")],
  ])("%s gives 404 with no data, with an identity", async (_name, request) => {
    const response = await request();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(notFound);
  });

  it.each([
    ["GET /anything", () => api("/anything", { as: null })],
    ["POST /upload", () => api("/upload", { method: "POST", as: null })],
    ["GET /API/me", () => api("/API/me", { as: null })],
  ])("%s gives 404 with no data, with no identity", async (_name, request) => {
    const response = await request();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(notFound);
  });

  // GET / is asserted separately: some test environments serve dist/index.html
  // for it (a placeholder asset makes the assets layer answer before the
  // Worker runs), so which branch below applies depends on the environment.
  // Whichever branch runs, it asserts the actual response precisely, so this
  // fails if the catch-all were removed or answered with different JSON.
  it("GET / is either the catch-all's 404 JSON or a served static file, with or without an identity", async () => {
    for (const as of [undefined, null]) {
      const response = await api("/", { as });
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual(notFound);
      } else {
        expect(response.status).toBe(200);
        expect(contentType).toContain("text/html");
        const body = await response.text();
        expect(() => JSON.parse(body)).toThrow();
      }
    }
  });
});

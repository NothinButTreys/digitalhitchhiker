import { describe, expect, it } from "vitest";
import { api } from "./helpers";

describe("GET /api/health", () => {
  it("answers without an identity", async () => {
    const response = await api("/api/health", { as: null });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: "digital-hitchhiker-admin" });
  });
});

describe("unknown API route", () => {
  it("returns a JSON 404", async () => {
    const response = await api("/api/nope");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found", message: "No such route." });
  });
});

import { Hono } from "hono";
import { createLocalJWKSet, errors, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv, Env, Identity } from "../src/env";
import { identityFromClaims, requireOwner, resolveIdentity, verifyAccessToken } from "../src/lib/auth";
import { ApiError } from "../src/lib/errors";

const base = {
  ENVIRONMENT: "production",
  AUTH_MODE: "access",
  OWNER_EMAIL: "owner@example.com",
  ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
  ACCESS_AUD: "aud-123",
  SERVICE_TOKEN_CLIENT_ID: "svc.access",
} as Env;

describe("identityFromClaims", () => {
  it("accepts the owner's email, ignoring case", () => {
    expect(identityFromClaims({ email: "Owner@Example.com" }, base)).toEqual({
      kind: "owner",
      email: "owner@example.com",
    });
  });

  it("refuses another email", () => {
    expect(identityFromClaims({ email: "someone@example.com" }, base)).toBeNull();
  });

  it("refuses a superstring of the owner's email (prefix match)", () => {
    expect(identityFromClaims({ email: "owner@example.com.evil.test" }, base)).toBeNull();
  });

  it("refuses a string the owner's email is a suffix of", () => {
    expect(identityFromClaims({ email: "xowner@example.com" }, base)).toBeNull();
  });

  it("refuses everyone when OWNER_EMAIL is empty", () => {
    expect(identityFromClaims({ email: "" }, { ...base, OWNER_EMAIL: "" })).toBeNull();
    expect(identityFromClaims({ email: "owner@example.com" }, { ...base, OWNER_EMAIL: "" })).toBeNull();
  });

  it("accepts the configured service token", () => {
    expect(identityFromClaims({ common_name: "svc.access" }, base)).toEqual({
      kind: "service",
      clientId: "svc.access",
    });
  });

  it("refuses another service token, and any when none is configured", () => {
    expect(identityFromClaims({ common_name: "other.access" }, base)).toBeNull();
    expect(identityFromClaims({ common_name: "" }, { ...base, SERVICE_TOKEN_CLIENT_ID: "" })).toBeNull();
  });

  it("decides the outcome from a present email claim, however it is shaped, never falling through to the service check", () => {
    const service = "svc.access";
    expect(identityFromClaims({ email: 123, common_name: service }, base)).toBeNull();
    expect(identityFromClaims({ email: null, common_name: service }, base)).toBeNull();
    expect(identityFromClaims({ email: "", common_name: service }, base)).toBeNull();
    expect(identityFromClaims({ email: "  ", common_name: service }, base)).toBeNull();
    expect(identityFromClaims({ email: ["owner@example.com"], common_name: service }, base)).toBeNull();
    expect(identityFromClaims({ email: "someone@example.com", common_name: service }, base)).toBeNull();
  });

  it("refuses a non-ASCII lookalike character even when it case-folds to the owner's address", () => {
    // U+212A KELVIN SIGN lower-cases to "k" via String.prototype.toLowerCase(),
    // which would otherwise let this compare equal to "kowner@example.com".
    const env = { ...base, OWNER_EMAIL: "kowner@example.com" };
    expect(identityFromClaims({ email: "Kowner@example.com" }, env)).toBeNull();
    expect(identityFromClaims({ email: "Kowner@example.com" }, env)).toEqual({
      kind: "owner",
      email: "kowner@example.com",
    });
  });

  it("refuses an email containing a space, a tab, or a newline inside it", () => {
    expect(identityFromClaims({ email: "own er@example.com" }, base)).toBeNull();
    expect(identityFromClaims({ email: "own\ter@example.com" }, base)).toBeNull();
    expect(identityFromClaims({ email: "own\ner@example.com" }, base)).toBeNull();
  });

  it("refuses everyone when OWNER_EMAIL itself contains a non-ASCII character", () => {
    expect(identityFromClaims({ email: "owner@example.com" }, { ...base, OWNER_EMAIL: "Kowner@example.com" })).toBeNull();
    expect(identityFromClaims({ email: "Kowner@example.com" }, { ...base, OWNER_EMAIL: "Kowner@example.com" })).toBeNull();
  });
});

describe("with the four identity settings absent", () => {
  // As deployed before the secrets are set: wrangler.jsonc no longer
  // declares OWNER_EMAIL, ACCESS_TEAM_DOMAIN, ACCESS_AUD, or
  // SERVICE_TOKEN_CLIENT_ID, so the Worker sees them as undefined.
  const bare = { ENVIRONMENT: "production", AUTH_MODE: "access" } as Env;

  it("refuses every claims shape with null and throws nothing", () => {
    const shapes: Record<string, unknown>[] = [
      {},
      { email: "owner@example.com" },
      { email: "" },
      { email: 123 },
      { common_name: "svc.access" },
      { common_name: "" },
      { common_name: 42 },
      { email: "owner@example.com", common_name: "svc.access" },
    ];
    for (const claims of shapes) {
      expect(() => identityFromClaims(claims, bare)).not.toThrow();
      expect(identityFromClaims(claims, bare)).toBeNull();
    }
  });

  it("resolves no identity in access mode or dev mode, and throws nothing", async () => {
    const withToken = new Request("https://admin.test/api/me", { headers: { "Cf-Access-Jwt-Assertion": "a.b.c" } });
    expect(await resolveIdentity(withToken, bare)).toBeNull();
    const withDevHeader = new Request("https://admin.test/api/me", { headers: { "x-dev-email": "owner@example.com" } });
    expect(await resolveIdentity(withDevHeader, { ...bare, AUTH_MODE: "dev", ENVIRONMENT: "test" })).toBeNull();
  });
});

describe("verifyAccessToken", () => {
  let keys: ReturnType<typeof createLocalJWKSet>;
  let sign: (claims: Record<string, unknown>, options?: { iss?: string; aud?: string; exp?: string }) => Promise<string>;
  let signWithOtherKey: (claims: Record<string, unknown>) => Promise<string>;
  let goodPrivateKey: CryptoKey;

  beforeAll(async () => {
    const good = await generateKeyPair("RS256");
    const other = await generateKeyPair("RS256");
    goodPrivateKey = good.privateKey;
    keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(good.publicKey)), kid: "k1", alg: "RS256" }] });
    const make = (key: CryptoKey) => (claims: Record<string, unknown>, options: { iss?: string; aud?: string; exp?: string } = {}) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(options.iss ?? "https://team.cloudflareaccess.com")
        .setAudience(options.aud ?? "aud-123")
        .setIssuedAt()
        .setExpirationTime(options.exp ?? "5m")
        .sign(key);
    sign = make(good.privateKey);
    signWithOtherKey = make(other.privateKey);
  });

  it("accepts a valid owner token", async () => {
    const token = await sign({ email: "owner@example.com" });
    expect(await verifyAccessToken(token, base, keys)).toEqual({ kind: "owner", email: "owner@example.com" });
  });

  it("refuses a token signed by another key", async () => {
    expect(await verifyAccessToken(await signWithOtherKey({ email: "owner@example.com" }), base, keys)).toBeNull();
  });

  it("refuses the wrong audience, the wrong issuer, and an expired token", async () => {
    expect(await verifyAccessToken(await sign({ email: "owner@example.com" }, { aud: "other" }), base, keys)).toBeNull();
    expect(await verifyAccessToken(await sign({ email: "owner@example.com" }, { iss: "https://evil.example" }), base, keys)).toBeNull();
    expect(await verifyAccessToken(await sign({ email: "owner@example.com" }, { exp: "-1m" }), base, keys)).toBeNull();
  });

  it("refuses when the team domain or audience is not configured", async () => {
    const token = await sign({ email: "owner@example.com" });
    expect(await verifyAccessToken(token, { ...base, ACCESS_AUD: "" }, keys)).toBeNull();
    expect(await verifyAccessToken(token, { ...base, ACCESS_TEAM_DOMAIN: "" }, keys)).toBeNull();
  });

  it("refuses text that is not a token", async () => {
    expect(await verifyAccessToken("not-a-jwt", base, keys)).toBeNull();
  });

  it("refuses a correctly signed token with no exp claim", async () => {
    const token = await new SignJWT({ email: "owner@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer("https://team.cloudflareaccess.com")
      .setAudience("aud-123")
      .setIssuedAt()
      .sign(goodPrivateKey);
    expect(await verifyAccessToken(token, base, keys)).toBeNull();
  });

  describe("when verification cannot run to a conclusion", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("logs the error's code once, and never the token", async () => {
      const token = await sign({ email: "owner@example.com" });
      const throwingKeys = (async () => {
        throw Object.assign(new Error("JWKS request timed out"), { code: "ERR_JWKS_TIMEOUT" });
      }) as unknown as typeof keys;

      expect(await verifyAccessToken(token, base, throwingKeys)).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).toContain("ERR_JWKS_TIMEOUT");
      expect(message).not.toContain(token);
    });

    it("does not log for a token with a bad signature", async () => {
      const token = await signWithOtherKey({ email: "owner@example.com" });
      expect(await verifyAccessToken(token, base, keys)).toBeNull();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("refuses a token signed with a different algorithm by a key in the key set, and logs it", async () => {
      const other = await generateKeyPair("ES256");
      const mixedKeys = createLocalJWKSet({
        keys: [
          { ...(await exportJWK((await generateKeyPair("RS256")).publicKey)), kid: "k1", alg: "RS256" },
          { ...(await exportJWK(other.publicKey)), kid: "k2", alg: "ES256" },
        ],
      });
      const token = await new SignJWT({ email: "owner@example.com" })
        .setProtectedHeader({ alg: "ES256", kid: "k2" })
        .setIssuer("https://team.cloudflareaccess.com")
        .setAudience("aud-123")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(other.privateKey);

      expect(await verifyAccessToken(token, base, mixedKeys)).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).toContain(errors.JOSEAlgNotAllowed.code);
      expect(message).not.toContain(token);
    });
  });
});

describe("resolveIdentity in dev mode", () => {
  const request = (email?: string) =>
    new Request("https://admin.test/api/me", { headers: email ? { "x-dev-email": email } : {} });

  it("accepts the owner's email in development and test", async () => {
    for (const ENVIRONMENT of ["development", "test"]) {
      expect(await resolveIdentity(request("owner@example.com"), { ...base, AUTH_MODE: "dev", ENVIRONMENT })).toEqual({
        kind: "owner",
        email: "owner@example.com",
      });
    }
  });

  it("refuses dev mode in production", async () => {
    expect(await resolveIdentity(request("owner@example.com"), { ...base, AUTH_MODE: "dev", ENVIRONMENT: "production" })).toBeNull();
  });

  it("refuses another email and a missing header", async () => {
    const env = { ...base, AUTH_MODE: "dev", ENVIRONMENT: "test" };
    expect(await resolveIdentity(request("someone@example.com"), env)).toBeNull();
    expect(await resolveIdentity(request(), env)).toBeNull();
  });

  it("refuses an unknown auth mode", async () => {
    expect(await resolveIdentity(request("owner@example.com"), { ...base, AUTH_MODE: "off", ENVIRONMENT: "test" })).toBeNull();
  });

  it("ignores the dev header in access mode", async () => {
    expect(await resolveIdentity(request("owner@example.com"), base)).toBeNull();
  });
});

describe("resolveIdentity with the dev cookie", () => {
  // <img> requests carry cookies but not custom headers, so local previews
  // need the dev identity in a cookie too. Only ever under the same gate as
  // the header.
  const request = (headers: Record<string, string>) => new Request("https://admin.test/api/photos/p1/preview", { headers });
  const devEnv = (ENVIRONMENT: string) => ({ ...base, AUTH_MODE: "dev", ENVIRONMENT });

  it("accepts the owner's address from the cookie in development and test", async () => {
    for (const ENVIRONMENT of ["development", "test"]) {
      for (const value of ["owner@example.com", "owner%40example.com"]) {
        expect(await resolveIdentity(request({ cookie: `other=1; dh-dev-email=${value}` }), devEnv(ENVIRONMENT))).toEqual({
          kind: "owner",
          email: "owner@example.com",
        });
      }
    }
  });

  it("refuses another address, a malformed value, and a cookie of another name", async () => {
    const env = devEnv("test");
    expect(await resolveIdentity(request({ cookie: "dh-dev-email=someone%40example.com" }), env)).toBeNull();
    expect(await resolveIdentity(request({ cookie: "dh-dev-email=%E0%A4%A" }), env)).toBeNull();
    expect(await resolveIdentity(request({ cookie: "x-dh-dev-email=owner%40example.com" }), env)).toBeNull();
  });

  it("ignores the cookie in access mode, and in dev mode outside development and test", async () => {
    const cookie = { cookie: "dh-dev-email=owner%40example.com" };
    expect(await resolveIdentity(request(cookie), base)).toBeNull();
    expect(await resolveIdentity(request(cookie), { ...base, ENVIRONMENT: "development" })).toBeNull();
    expect(await resolveIdentity(request(cookie), devEnv("production"))).toBeNull();
  });

  it("lets the header win over a differing cookie", async () => {
    const env = devEnv("test");
    expect(
      await resolveIdentity(request({ "x-dev-email": "owner@example.com", cookie: "dh-dev-email=someone%40example.com" }), env),
    ).toEqual({ kind: "owner", email: "owner@example.com" });
    expect(
      await resolveIdentity(request({ "x-dev-email": "someone@example.com", cookie: "dh-dev-email=owner%40example.com" }), env),
    ).toBeNull();
  });
});

describe("resolveIdentity in access mode", () => {
  let keys: ReturnType<typeof createLocalJWKSet>;
  let signOwner: () => Promise<string>;
  let signOther: () => Promise<string>;

  beforeAll(async () => {
    const good = await generateKeyPair("RS256");
    keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(good.publicKey)), kid: "k1", alg: "RS256" }] });
    const sign = (email: string) =>
      new SignJWT({ email })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer("https://team.cloudflareaccess.com")
        .setAudience("aud-123")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(good.privateKey);
    signOwner = () => sign("owner@example.com");
    signOther = () => sign("someone@example.com");
  });

  const request = (token?: string) =>
    new Request("https://admin.test/api/me", { headers: token ? { "Cf-Access-Jwt-Assertion": token } : {} });

  it("resolves the owner from a valid token, through the same function requests use", async () => {
    expect(await resolveIdentity(request(await signOwner()), base, keys)).toEqual({
      kind: "owner",
      email: "owner@example.com",
    });
  });

  it("resolves null with no header", async () => {
    expect(await resolveIdentity(request(), base, keys)).toBeNull();
  });

  it("resolves null for a valid token belonging to another email", async () => {
    expect(await resolveIdentity(request(await signOther()), base, keys)).toBeNull();
  });
});

describe("requireOwner", () => {
  function appWithIdentity(identity: Identity) {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("identity", identity);
      await next();
    });
    app.use("*", requireOwner);
    app.get("/", (c) => c.json({ ok: true }));
    app.onError((error, c) => {
      if (error instanceof ApiError) return c.json({ error: error.code, message: error.message }, error.status);
      throw error;
    });
    return app;
  }

  it("answers 403 for a service identity", async () => {
    const response = await appWithIdentity({ kind: "service", clientId: "svc" }).request("/");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden", message: "This identity may not do that." });
  });

  it("answers 200 for an owner identity", async () => {
    const response = await appWithIdentity({ kind: "owner", email: "owner@example.com" }).request("/");
    expect(response.status).toBe(200);
  });
});

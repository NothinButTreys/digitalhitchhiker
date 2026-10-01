import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { AppEnv, Env, Identity } from "../env";
import { forbidden, unauthorized } from "./errors";

const remoteKeys = new Map<string, JWTVerifyGetKey>();

function keysFor(teamDomain: string): JWTVerifyGetKey {
  let keys = remoteKeys.get(teamDomain);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    remoteKeys.set(teamDomain, keys);
  }
  return keys;
}

// Printable ASCII only (0x21-0x7E), after trimming. Excludes whitespace of any
// kind and any lookalike character (e.g. U+212A KELVIN SIGN, which
// String.prototype.toLowerCase() maps to "k") that could compare equal to an
// ASCII address after case-folding.
const ASCII_ADDRESS = /^[\x21-\x7e]+$/;

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || !ASCII_ADDRESS.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

// Every identity setting may be absent (they are secrets, set after the first
// deploy). normalizedEmail() refuses a missing OWNER_EMAIL, a missing
// SERVICE_TOKEN_CLIENT_ID reads as "", and verifyAccessToken() refuses when
// ACCESS_TEAM_DOMAIN or ACCESS_AUD is missing: absent means refuse everyone.
export function identityFromClaims(claims: Record<string, unknown>, env: Env): Identity | null {
  if ("email" in claims) {
    const owner = normalizedEmail(env.OWNER_EMAIL);
    const email = normalizedEmail(claims.email);
    return owner && email && email === owner ? { kind: "owner", email } : null;
  }

  const service = (env.SERVICE_TOKEN_CLIENT_ID ?? "").trim();
  const commonName = typeof claims.common_name === "string" ? claims.common_name.trim() : "";
  if (service !== "" && commonName === service) return { kind: "service", clientId: commonName };
  return null;
}

// Ordinary outcomes of validating a token an attacker or a misconfigured
// client presented: a bad or absent claim (including a missing/expired "exp"),
// a signature that does not check out, or a malformed token. These happen
// constantly in normal operation and are not logged. Anything else — the key
// set could not be fetched, the JWKS itself is invalid, no key or too many
// keys matched, the token used an algorithm this Worker does not allow, or an
// error jose never defined at all — means verification could not run to a
// conclusion, which is worth knowing about. In particular, if Cloudflare
// Access ever signed with an algorithm outside the allow-list, the owner
// would be locked out silently unless this is logged.
const ORDINARY_TOKEN_ERROR_CODES = new Set<string>([
  errors.JWTClaimValidationFailed.code,
  errors.JWTExpired.code,
  errors.JWSSignatureVerificationFailed.code,
  errors.JWTInvalid.code,
  errors.JWSInvalid.code,
]);

function isOrdinaryTokenError(error: unknown): boolean {
  return error instanceof errors.JOSEError && ORDINARY_TOKEN_ERROR_CODES.has(error.code);
}

// Never pass the error itself to console.warn (it may carry the payload/claims
// of the rejected token); extract only a short, stable label.
function errorLabel(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "unknown_error";
}

export async function verifyAccessToken(
  token: string,
  env: Env,
  keys?: JWTVerifyGetKey,
): Promise<Identity | null> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  try {
    const { payload } = await jwtVerify(token, keys ?? keysFor(env.ACCESS_TEAM_DOMAIN), {
      issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
      audience: env.ACCESS_AUD,
      algorithms: ["RS256"],
      requiredClaims: ["exp"],
    });
    return identityFromClaims(payload, env);
  } catch (error) {
    if (!isOrdinaryTokenError(error)) {
      console.warn(`verifyAccessToken: could not verify token (${errorLabel(error)})`);
    }
    return null;
  }
}

export const DEV_EMAIL_COOKIE = "dh-dev-email";

// The value of cookie `name`, percent-decoded, or null when it is absent or
// its value is not valid percent-encoding.
function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at === -1 || part.slice(0, at).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(at + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export async function resolveIdentity(
  request: Request,
  env: Env,
  keys?: JWTVerifyGetKey,
): Promise<Identity | null> {
  if (env.AUTH_MODE === "access") {
    const token = request.headers.get("Cf-Access-Jwt-Assertion");
    return token ? verifyAccessToken(token, env, keys) : null;
  }
  if (env.AUTH_MODE === "dev" && (env.ENVIRONMENT === "development" || env.ENVIRONMENT === "test")) {
    // The cookie exists for <img> requests, which cannot carry the header.
    // It is read only here, under exactly the header's gate; when both are
    // present the header wins.
    const email = request.headers.get("x-dev-email") ?? cookieValue(request, DEV_EMAIL_COOKIE);
    if (email !== null) return identityFromClaims({ email }, env);
    // The publish workflow's stand-in, under the same gate. It is checked
    // against SERVICE_TOKEN_CLIENT_ID exactly as a real service token is.
    const serviceId = request.headers.get("x-dev-service-id");
    return serviceId === null ? null : identityFromClaims({ common_name: serviceId }, env);
  }
  return null;
}

export const requireIdentity = createMiddleware<AppEnv>(async (c, next) => {
  const identity = await resolveIdentity(c.req.raw, c.env);
  if (!identity) throw unauthorized();
  c.set("identity", identity);
  await next();
});

export const requireOwner = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get("identity").kind !== "owner") throw forbidden();
  await next();
});

export const requireService = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get("identity").kind !== "service") throw forbidden();
  await next();
});

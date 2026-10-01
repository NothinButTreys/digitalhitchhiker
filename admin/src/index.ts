import { Hono } from "hono";
import { failStalePublishes } from "./db/publishes";
import type { AppEnv, Env } from "./env";
import { requireIdentity, requireOwner } from "./lib/auth";
import { ApiError } from "./lib/errors";
import { categories } from "./routes/categories";
import { categoryPhotos, photos } from "./routes/photos";
import { publishes } from "./routes/publishes";
import { service } from "./routes/service";
import { cleanUpStaleUploads, uploads } from "./routes/uploads";

const app = new Hono<AppEnv>();

app.get("/api/health", (c) => c.json({ ok: true, service: "digital-hitchhiker-admin" }));

app.use("/api/*", requireIdentity);

app.get("/api/me", (c) => c.json(c.get("identity")));

// Mounted before the owner's router and with its own gate: a service
// identity reaches only these, and the owner reaches none of them.
app.route("/api/service", service);

const owner = new Hono<AppEnv>();
owner.use("*", requireOwner);
owner.route("/categories", categories);
owner.route("/categories", categoryPhotos);
owner.route("/photos", photos);
owner.route("/uploads", uploads);
owner.route("/publishes", publishes);
app.route("/api", owner);

// Static files are served by the assets layer before the Worker runs.
// Anything else that reaches the Worker and is not an API route is refused
// here, so a route added outside /api by mistake can never serve data.
app.all("*", (c) => c.json({ error: "not_found", message: "No such route." }, 404));

app.onError((error, c) => {
  if (error instanceof ApiError) {
    return c.json({ error: error.code, message: error.message, ...error.details }, error.status);
  }
  console.error(error);
  return c.json({ error: "internal", message: "Something went wrong." }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(cleanUpStaleUploads(env, new Date()));
    ctx.waitUntil(failStalePublishes(env.DB, new Date()));
  },
};

export { app };

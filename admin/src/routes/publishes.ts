import { Hono } from "hono";
import { z } from "zod";
import { createPublish, failStalePublishes, publishState, recordStatus } from "../db/publishes";
import { buildSnapshot } from "../db/snapshot";
import type { AppEnv } from "../env";
import { ApiError, conflict } from "../lib/errors";
import { dispatchPublish } from "../lib/github";
import { parse, readJson } from "../lib/request";

const startSchema = z.object({ target: z.enum(["preview", "production"]) }).strict();

export const publishes = new Hono<AppEnv>();

publishes.get("/state", async (c) => c.json(await publishState(c.env.DB, new Date())));

publishes.post("/", async (c) => {
  const { target } = parse(startSchema, await readJson(c.req.raw));
  await failStalePublishes(c.env.DB, new Date());

  const { snapshot, problems } = await buildSnapshot(c.env.DB);
  if (problems.length > 0) throw conflict("not_publishable", problems[0]!, { problems });

  const publish = await createPublish(c.env.DB, target, snapshot, new Date());
  try {
    await dispatchPublish(c.env, { publishId: publish.id, target });
  } catch (error) {
    // Nothing is running, so the publish must not stay "queued" and block
    // the next one for half an hour.
    const message = error instanceof ApiError ? error.message : "Could not start the publish.";
    await recordStatus(c.env.DB, publish.id, { status: "failed", message, url: "" }, new Date());
    throw error;
  }
  return c.json(publish, 201);
});

import type { z } from "zod";
import { ApiError, badRequest } from "./errors";

const JSON_TYPE = /^application\/json\s*(?:;\s*charset=[\w-]+\s*)?$/i;

// Only a body declared as JSON is read. A cross-site HTML form can send
// `text/plain`, `application/x-www-form-urlencoded`, or `multipart/form-data`
// without a CORS preflight, and would carry the owner's Access cookie; none
// of those is accepted, so such a form can never act as the owner.
export async function readJson(request: Request): Promise<unknown> {
  if (!JSON_TYPE.test((request.headers.get("content-type") ?? "").trim())) {
    throw new ApiError(415, "unsupported_type", "Send JSON.");
  }
  try {
    return await request.json();
  } catch {
    throw badRequest("invalid", "The request body must be JSON.");
  }
}

export function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const message = result.error.issues
    .map((issue) => `${issue.path.join(".") || "body"} ${issue.message}`)
    .join("; ");
  throw badRequest("invalid", message);
}

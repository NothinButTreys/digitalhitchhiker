import type { Env } from "../env";
import { ApiError } from "./errors";

/** The one network call this file makes, as a property so that tests can stand in for it. */
export const github = {
  fetch: (url: string, init: RequestInit): Promise<Response> => fetch(url, init),
};

type Settings = Pick<Env, "GITHUB_DISPATCH_TOKEN" | "GITHUB_REPO" | "GITHUB_WORKFLOW" | "GITHUB_REF">;

const failed = (message: string) => new ApiError(502, "dispatch_failed", message);

/**
 * Starts the publish workflow for one publish. The messages here are shown
 * to the owner, so they never carry the token or GitHub's own reply.
 */
export async function dispatchPublish(env: Settings, input: { publishId: string; target: "preview" | "production" }): Promise<void> {
  const token = (env.GITHUB_DISPATCH_TOKEN ?? "").trim();
  if (!token) throw failed("Publishing is not set up yet: the token that starts it is missing.");

  let response: Response;
  try {
    response = await github.fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW}/dispatches`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "digital-hitchhiker-admin",
          "content-type": "application/json",
        },
        body: JSON.stringify({ ref: env.GITHUB_REF, inputs: { publish_id: input.publishId, target: input.target } }),
        // A hanging call would hold the single-publish lock; the catch below turns the abort into a plain failure.
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw failed("Could not reach GitHub to start the publish.");
  }
  if (response.status !== 204) throw failed(`GitHub refused to start the publish (status ${response.status}).`);
}

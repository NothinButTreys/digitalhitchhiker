import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchPublish, github } from "../src/lib/github";

afterEach(() => vi.restoreAllMocks());

const env = { GITHUB_DISPATCH_TOKEN: " test-token ", GITHUB_REPO: "example/site", GITHUB_WORKFLOW: "publish.yml", GITHUB_REF: "main" };

describe("dispatchPublish", () => {
  it("asks GitHub to run the workflow for this publish", async () => {
    const fetch = vi.spyOn(github, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await dispatchPublish(env, { publishId: "p-1", target: "preview" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/example/site/actions/workflows/publish.yml/dispatches");
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer test-token");
    expect(headers.get("user-agent")).toBe("digital-hitchhiker-admin");
    expect(JSON.parse(init.body as string)).toEqual({ ref: "main", inputs: { publish_id: "p-1", target: "preview" } });
  });

  it("fails without calling GitHub when the token has not been set", async () => {
    const fetch = vi.spyOn(github, "fetch");
    await expect(dispatchPublish({ ...env, GITHUB_DISPATCH_TOKEN: undefined }, { publishId: "p-1", target: "preview" })).rejects.toMatchObject({
      status: 502,
      code: "dispatch_failed",
      message: "Publishing is not set up yet: the token that starts it is missing.",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports GitHub's refusal by status, never repeating the token", async () => {
    vi.spyOn(github, "fetch").mockResolvedValue(new Response("Bad credentials test-token", { status: 401 }));
    const error = await dispatchPublish(env, { publishId: "p-1", target: "production" }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 502, code: "dispatch_failed", message: "GitHub refused to start the publish (status 401)." });
    expect(JSON.stringify(error)).not.toContain("test-token");
  });

  it("reports that GitHub could not be reached", async () => {
    vi.spyOn(github, "fetch").mockRejectedValue(new Error("network down"));
    await expect(dispatchPublish(env, { publishId: "p-1", target: "preview" })).rejects.toMatchObject({
      status: 502,
      message: "Could not reach GitHub to start the publish.",
    });
  });
});

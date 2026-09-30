import { describe, expect, it, vi } from "vitest";
import { CommandError, buildForVercel, deployPrebuilt } from "./deploy";

describe("buildForVercel", () => {
  it("pulls the preview settings and builds", async () => {
    const exec = vi.fn(async () => "");
    await buildForVercel(exec, "preview");
    expect(exec.mock.calls).toEqual([
      ["vercel", ["pull", "--yes", "--environment=preview"], { quiet: true }],
      ["vercel", ["build"], { quiet: true }],
    ]);
  });

  it("pulls the production settings and builds for production", async () => {
    const exec = vi.fn(async () => "");
    await buildForVercel(exec, "production");
    expect(exec.mock.calls).toEqual([
      ["vercel", ["pull", "--yes", "--environment=production"], { quiet: true }],
      ["vercel", ["build", "--prod"], { quiet: true }],
    ]);
  });
});

describe("deployPrebuilt", () => {
  it("deploys what was built and gives the address Vercel prints", async () => {
    const exec = vi.fn(async () => "Inspect: see dashboard\nhttps://site-abc123.vercel.app\n");
    expect(await deployPrebuilt(exec, "preview")).toBe("https://site-abc123.vercel.app");
    expect(exec).toHaveBeenCalledWith("vercel", ["deploy", "--prebuilt"], { quiet: true });
  });

  it("deploys to production when asked", async () => {
    const exec = vi.fn(async () => "https://site-prod.vercel.app");
    await deployPrebuilt(exec, "production");
    expect(exec).toHaveBeenCalledWith("vercel", ["deploy", "--prebuilt", "--prod"], { quiet: true });
  });

  it("fails when Vercel prints no address", async () => {
    await expect(deployPrebuilt(async () => "done", "preview")).rejects.toThrow("Vercel did not say where it deployed.");
  });
});

describe("CommandError", () => {
  it("keeps a quiet command's output out of what may be logged in public", () => {
    const quiet = new CommandError("`vercel deploy` ended with code 1.", "Error: team some-account not found", true);
    expect(quiet.message).toBe("`vercel deploy` ended with code 1.\nError: team some-account not found");
    expect(quiet.publicMessage).toBe("`vercel deploy` ended with code 1.");
    const loud = new CommandError("`npm test` ended with code 1.", "1 test failed", false);
    expect(loud.publicMessage).toBe(loud.message);
  });
});

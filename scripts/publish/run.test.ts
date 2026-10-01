import { describe, expect, it, vi } from "vitest";
import { CommandError } from "./deploy";
import type { StatusUpdate } from "./library";
import { SITE_ORIGIN, publish, type Steps } from "./run";
import { SITE } from "../../src/data/site";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Snapshot } from "./snapshot";

const snapshot = { version: 1, categories: [] } as unknown as Snapshot;

function steps(overrides: Partial<Steps> = {}) {
  const reports: StatusUpdate[] = [];
  const commands: string[] = [];
  const base: Steps = {
    getSnapshot: async () => ({ target: "preview", snapshot }),
    reportStatus: async (_id, update) => {
      reports.push(update);
      return true;
    },
    materialize: async (_snapshot, onProgress) => {
      await onProgress(1, 2);
      await onProgress(2, 2);
      return { categories: 2, photographs: 2, encoded: 1, removed: [] };
    },
    compare: async () => null,
    exec: async (command, args) => {
      commands.push([command, ...args].join(" "));
      return command === "vercel" && args[0] === "deploy" ? "https://preview-abc.vercel.app" : "";
    },
    log: () => {},
    now: () => 0,
    siteOrigin: "https://site.example",
  };
  return { reports, commands, steps: { ...base, ...overrides } };
}

describe("publish", () => {
  it("prepares, tests, builds, checks, deploys, and reports the preview's address", async () => {
    const { reports, commands, steps: s } = steps();
    await publish("p1", s);
    expect(commands).toEqual([
      "npm test",
      "vercel pull --yes --environment=preview",
      "vercel build",
      "npm run test:build",
      "npx playwright install chromium",
      "npm run test:e2e",
      "vercel deploy --prebuilt",
    ]);
    expect(reports.map((report) => [report.status, report.message])).toEqual([
      ["running", "Fetching the library"],
      ["running", "Preparing photographs (2 of 2)"],
      ["running", "Running the site's tests"],
      ["running", "Building the site"],
      ["running", "Checking the built site"],
      ["running", "Deploying"],
      ["succeeded", "A preview of 2 photographs in 2 categories is ready."],
    ]);
    expect(reports.at(-1)!.url).toBe("https://preview-abc.vercel.app");
  });

  it("reports the site's own address after a production publish", async () => {
    const { reports, commands, steps: s } = steps({ getSnapshot: async () => ({ target: "production", snapshot }) });
    await publish("p1", s);
    expect(commands).toContain("vercel build --prod");
    expect(commands.at(-1)).toBe("vercel deploy --prebuilt --prod");
    expect(reports.at(-1)).toEqual({ status: "succeeded", message: "Published 2 photographs in 2 categories.", url: "https://site.example" });
  });

  it("reports progress on preparing photographs no more than once every fifteen seconds, and always at the end", async () => {
    let clock = 0;
    const { reports, steps: s } = steps({
      now: () => clock,
      materialize: async (_snapshot, onProgress) => {
        for (let done = 1; done <= 5; done += 1) {
          clock += 6_000;
          await onProgress(done, 5);
        }
        return { categories: 1, photographs: 5, encoded: 5, removed: [] };
      },
    });
    await publish("p1", s);
    expect(reports.map((report) => report.message).filter((message) => message.startsWith("Preparing"))).toEqual([
      "Preparing photographs (3 of 5)",
      "Preparing photographs (5 of 5)",
    ]);
  });

  it("stops before building when the library does not reproduce the committed site, and says how it differs", async () => {
    const differences = Array.from({ length: 7 }, (_, index) => `public/photos/zoo/p-${index}.jpg differs`);
    const { reports, commands, steps: s } = steps({ compare: async () => differences });
    await expect(publish("p1", s)).rejects.toThrow();
    expect(commands).toEqual([]);
    expect(reports.at(-1)).toEqual({
      status: "failed",
      message:
        "Comparing with the site as it is now failed. The library does not reproduce the site yet: " +
        "public/photos/zoo/p-0.jpg differs; public/photos/zoo/p-1.jpg differs; public/photos/zoo/p-2.jpg differs; " +
        "public/photos/zoo/p-3.jpg differs; public/photos/zoo/p-4.jpg differs; and 2 more.",
      url: "",
    });
  });

  it("carries on when the comparison finds no difference", async () => {
    const { reports, steps: s } = steps({ compare: async () => [] });
    await publish("p1", s);
    expect(reports.at(-1)!.status).toBe("succeeded");
  });

  it("reports which step failed and why, deploys nothing, and fails itself", async () => {
    const { reports, commands, steps: s } = steps({
      exec: async (command, args) => {
        if (args.join(" ") === "run test:build") throw new Error("1 test failed: dist/zoo/index.html has no title");
        return "";
      },
    });
    const tracked = { ...s, exec: vi.fn(s.exec) };
    await expect(publish("p1", tracked)).rejects.toThrow("1 test failed");
    expect(tracked.exec.mock.calls.map(([command, args]) => [command, ...args].join(" "))).not.toContain("vercel deploy --prebuilt");
    expect(reports.at(-1)).toEqual({
      status: "failed",
      message: "Checking the built site failed. 1 test failed: dist/zoo/index.html has no title",
      url: "",
    });
  });

  it("tells the owner what a quiet command printed, and the public log only that it failed", async () => {
    const lines: string[] = [];
    const { reports, steps: s } = steps({
      log: (line) => lines.push(line),
      exec: async (command, args) => {
        if (command === "vercel" && args[0] === "deploy") {
          throw new CommandError("`vercel deploy --prebuilt` ended with code 1.", "Error: the account some-account has no such project", true);
        }
        return "";
      },
    });
    await expect(publish("p1", s)).rejects.toThrow();
    expect(reports.at(-1)!.message).toBe(
      "Deploying failed. `vercel deploy --prebuilt` ended with code 1.\nError: the account some-account has no such project",
    );
    expect(lines.join("\n")).toContain("Deploying failed. `vercel deploy --prebuilt` ended with code 1.");
    expect(lines.join("\n")).not.toContain("some-account");
  });

  it("never writes a preview's address to the public log", async () => {
    const lines: string[] = [];
    const { steps: s } = steps({ log: (line) => lines.push(line) });
    await publish("p1", s);
    expect(lines.join("\n")).not.toContain("preview-abc");
  });

  it("keeps a failure message to a length the admin will accept", async () => {
    const { reports, steps: s } = steps({
      exec: async () => {
        throw new Error("x".repeat(5000));
      },
    });
    await expect(publish("p1", s)).rejects.toThrow();
    expect(reports.at(-1)!.message.length).toBeLessThanOrEqual(1600);
  });

  it("stops before anything is built when the admin no longer expects the publish", async () => {
    const { reports, commands, steps: s } = steps({
      reportStatus: async (_id, update) => {
        reports.push(update);
        return update.message !== "Running the site's tests";
      },
    });
    await expect(publish("p1", s)).rejects.toThrow("The admin no longer expects this publish; stopping without deploying.");
    expect(commands).toEqual([]);
    expect(reports.map((report) => report.status)).not.toContain("succeeded");
    expect(reports.at(-1)!.status).toBe("failed");
  });

  it("does not even fetch the snapshot when the first report is refused", async () => {
    const getSnapshot = vi.fn(async () => ({ target: "preview" as const, snapshot }));
    const { commands, steps: s } = steps({ getSnapshot, reportStatus: async () => false });
    await expect(publish("p1", s)).rejects.toThrow("The admin no longer expects this publish");
    expect(getSnapshot).not.toHaveBeenCalled();
    expect(commands).toEqual([]);
  });

  it("stops when a progress report is refused", async () => {
    const { commands, steps: s } = steps({
      reportStatus: async (_id, update) => !update.message.startsWith("Preparing photographs ("),
    });
    await expect(publish("p1", s)).rejects.toThrow("The admin no longer expects this publish");
    expect(commands).toEqual([]);
  });

  it("does not report a failure after the site is deployed, even when the outcome cannot be reported", async () => {
    const reports: StatusUpdate[] = [];
    const lines: string[] = [];
    const { steps: s } = steps({
      log: (line) => lines.push(line),
      reportStatus: async (_id, update) => {
        reports.push(update);
        if (update.status === "succeeded") throw new Error("The library answered 500 to POST /api/service/publishes/p1/status.");
        return true;
      },
    });
    await expect(publish("p1", s)).rejects.toThrow("The library answered 500");
    expect(reports.map((report) => report.status)).not.toContain("failed");
    expect(lines).toContain("Deployed, but the admin could not be told. The library answered 500 to POST /api/service/publishes/p1/status.");
    expect(lines.join("\n")).not.toContain("Deploying failed");
  });

  it("still fails when the failure itself cannot be reported", async () => {
    const { steps: s } = steps({
      getSnapshot: async () => {
        throw new Error("The library answered 500 to GET /api/service/publishes/p1/snapshot.");
      },
      reportStatus: async (_id, update) => {
        if (update.status === "failed") throw new Error("unreachable");
        return true;
      },
    });
    await expect(publish("p1", s)).rejects.toThrow("The library answered 500");
  });
});

describe("the publish scripts and the site's content", () => {
  it("name the same site", () => {
    expect(SITE_ORIGIN).toBe(SITE.origin);
  });

  // A publish's checkout has no content until these scripts have written it,
  // so none of them may load it, directly or through src/data/site.ts.
  it("never import the site's content, which does not exist until they have written it", () => {
    const folders = ["scripts/publish", "scripts/lib", "scripts/migrate"];
    const offenders: string[] = [];
    for (const folder of folders) {
      for (const name of readdirSync(folder)) {
        if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
        const text = readFileSync(path.join(folder, name), "utf8");
        if (/from "[^"]*(?:src\/data\/site|content\/[^"]*\.json)"/.test(text)) offenders.push(`${folder}/${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("logs when the admin had already given up by the time the deploy finished", async () => {
    const lines: string[] = [];
    const { steps: s } = steps({
      log: (line) => lines.push(line),
      reportStatus: async (_id, update) => update.status !== "succeeded",
    });
    await publish("p1", s);
    expect(lines).toContain("Deployed, but the admin had already given up on this publish.");
  });
});

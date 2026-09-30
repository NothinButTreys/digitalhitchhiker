import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { encodeOriginal } from "../lib/encode";
import { compareToCommitted } from "./compare";
import { CommandError, buildForVercel, deployPrebuilt, type Exec } from "./deploy";
import { createLibrary, type StatusUpdate, type Target } from "./library";
import { materialize, type MaterializeResult } from "./materialize";
import type { Snapshot } from "./snapshot";

/**
 * Where the site lives. Written here rather than read from src/data/site.ts:
 * that module loads content/set-order.json, which a publish's checkout does
 * not have until this very script has written it. Nothing under scripts/publish
 * may import the site's content; a test enforces it.
 */
export const SITE_ORIGIN = "https://digitalhitchhiker.photography";

/** Everything `publish` does to the outside world, so that a test can stand in for all of it. */
export type Steps = {
  getSnapshot(publishId: string): Promise<{ target: Target; snapshot: Snapshot }>;
  reportStatus(publishId: string, update: StatusUpdate): Promise<boolean>;
  materialize(snapshot: Snapshot, onProgress: (done: number, total: number) => Promise<void>): Promise<MaterializeResult>;
  /** Null when there is nothing committed to compare with. */
  compare(): Promise<string[] | null>;
  exec: Exec;
  log(line: string): void;
  now(): number;
  siteOrigin: string;
};

const PROGRESS_EVERY_MS = 15_000;
const MAX_MESSAGE = 1500;
const SHOWN_DIFFERENCES = 5;

const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

/**
 * Carries out one publish from start to finish and tells the admin how it
 * is going. Nothing is deployed unless every earlier step passed. Whatever
 * happens, the admin is told the outcome; if even that fails, the process
 * still ends with an error so the workflow's last step can report it.
 */
export async function publish(publishId: string, steps: Steps): Promise<void> {
  let step = "Fetching the library";
  let deployed = false;
  // False means the admin has given up on this publish (or it was never this
  // run's to carry out), so nothing further may be built or deployed.
  const stopped = () => new Error("The admin no longer expects this publish; stopping without deploying.");
  const say = async (message: string): Promise<boolean> => {
    step = message;
    steps.log(message);
    return steps.reportStatus(publishId, { status: "running", message });
  };

  try {
    if (!(await say(step))) throw stopped();
    const { target, snapshot } = await steps.getSnapshot(publishId);

    step = "Preparing photographs";
    let lastReport = steps.now();
    const result = await steps.materialize(snapshot, async (done, total) => {
      if (done < total && steps.now() - lastReport < PROGRESS_EVERY_MS) return;
      lastReport = steps.now();
      const message = `Preparing photographs (${done} of ${total})`;
      steps.log(message);
      if (!(await steps.reportStatus(publishId, { status: "running", message }))) throw stopped();
    });
    steps.log(`${plural(result.photographs, "photograph")}, ${result.encoded} newly encoded, ${result.removed.length} files removed`);

    step = "Comparing with the site as it is now";
    const differences = await steps.compare();
    if (differences && differences.length > 0) {
      const shown = differences.slice(0, SHOWN_DIFFERENCES).join("; ");
      const more = differences.length > SHOWN_DIFFERENCES ? `; and ${differences.length - SHOWN_DIFFERENCES} more` : "";
      throw new Error(`The library does not reproduce the site yet: ${shown}${more}.`);
    }

    if (!(await say("Running the site's tests"))) throw stopped();
    await steps.exec("npm", ["test"]);

    if (!(await say("Building the site"))) throw stopped();
    await buildForVercel(steps.exec, target);

    if (!(await say("Checking the built site"))) throw stopped();
    await steps.exec("npm", ["run", "test:build"]);
    await steps.exec("npx", ["playwright", "install", "chromium"]);
    await steps.exec("npm", ["run", "test:e2e"]);

    if (!(await say("Deploying"))) throw stopped();
    const url = await deployPrebuilt(steps.exec, target);
    deployed = true;

    const what = `${plural(result.photographs, "photograph")} in ${plural(result.categories, "category", "categories")}`;
    const recorded = await steps.reportStatus(
      publishId,
      target === "production"
        ? { status: "succeeded", message: `Published ${what}.`, url: steps.siteOrigin }
        : { status: "succeeded", message: `A preview of ${what} is ready.`, url },
    );
    // A refused final report means the admin gave up on this publish while the
    // deploy was under way. The site is live all the same; say so plainly.
    if (!recorded) steps.log("Deployed, but the admin had already given up on this publish.");
  } catch (error) {
    if (deployed) {
      // The site (or preview) is live. Saying "Deploying failed" would be false, so
      // only the log says what went wrong, and the rethrow still fails the workflow.
      steps.log(`Deployed, but the admin could not be told. ${error instanceof CommandError ? error.publicMessage : error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
    // The owner, in the admin, is told everything. The log is public, so it
    // gets only what a quiet command allows.
    const reason = error instanceof Error ? error.message : String(error);
    const message = `${step} failed. ${reason}`.slice(0, MAX_MESSAGE);
    steps.log(`${step} failed. ${error instanceof CommandError ? error.publicMessage : reason}`);
    await steps.reportStatus(publishId, { status: "failed", message, url: "" }).catch(() => false);
    throw error;
  }
}

/**
 * Runs a command and keeps the tail of what it printed for an error. Its
 * output is passed through to the log unless the command is quiet.
 */
const exec: Exec = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const quiet = options.quiet === true;
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let tail = "";
    const keep = (chunk: Buffer, isStdout: boolean) => {
      const text = chunk.toString("utf8");
      if (!quiet) process.stdout.write(text);
      if (isStdout) stdout += text;
      tail = (tail + text).slice(-4000);
    };
    child.stdout.on("data", (chunk: Buffer) => keep(chunk, true));
    child.stderr.on("data", (chunk: Buffer) => keep(chunk, false));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve(stdout);
      const lines = tail.trim().split("\n").slice(-12).join("\n");
      reject(new CommandError(`\`${[command, ...args].join(" ")}\` ended with code ${code}.`, lines, quiet));
    });
  });

function setting(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

function library() {
  return createLibrary({
    url: setting("LIBRARY_URL"),
    clientId: setting("LIBRARY_CLIENT_ID"),
    clientSecret: setting("LIBRARY_CLIENT_SECRET"),
  });
}

const PUBLISH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The publish's id as the admin writes it; it becomes part of a request path. */
function publishIdSetting(): string {
  const value = setting("PUBLISH_ID");
  if (!PUBLISH_ID.test(value)) throw new Error("PUBLISH_ID is not a publish id.");
  return value;
}

async function withWorkDir<T>(action: (workDir: string) => Promise<T>): Promise<T> {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "dh-publish-"));
  try {
    return await action(workDir);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function main(command: string | undefined): Promise<void> {
  const root = process.cwd();

  if (command === "publish") {
    const publishId = publishIdSetting();
    const lib = library();
    await withWorkDir((workDir) =>
      publish(publishId, {
        getSnapshot: lib.getSnapshot,
        reportStatus: lib.reportStatus,
        materialize: (snapshot, onProgress) =>
          materialize({ snapshot, store: lib, originals: lib.originalsFor(publishId), root, workDir, encode: encodeOriginal, onProgress }),
        compare: () => compareToCommitted(root),
        exec,
        log: (line) => console.log(line),
        now: () => Date.now(),
        siteOrigin: SITE_ORIGIN,
      }),
    );
    return;
  }

  if (command === "pull") {
    // For working on the site locally: the last published library, from the
    // cache only. Nothing is encoded and nothing is reported.
    const lib = library();
    const snapshot = await lib.getPublished();
    const result = await withWorkDir((workDir) =>
      materialize({ snapshot, store: lib, originals: null, root, workDir, encode: encodeOriginal }),
    );
    console.log(`Pulled ${plural(result.photographs, "photograph")} in ${plural(result.categories, "category", "categories")}.`);
    return;
  }

  if (command === "fail") {
    // The workflow's last step when an earlier one failed or was cancelled.
    // If the publish already reported its own outcome, this changes nothing.
    const recorded = await library().reportStatus(publishIdSetting(), {
      status: "failed",
      message: "The publish stopped before it could say why. See the workflow's log.",
    });
    console.log(recorded ? "Reported the failure." : "The outcome had already been reported.");
    return;
  }

  throw new Error("Usage: tsx scripts/publish/run.ts publish | pull | fail");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).catch((error: unknown) => {
    if (error instanceof CommandError) console.error(error.publicMessage);
    else console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

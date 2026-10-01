import type { Target } from "./library";

/**
 * Runs a command and resolves with its standard output. A quiet command's
 * output is kept out of the log, which is public.
 */
export type Exec = (command: string, args: string[], options?: { quiet?: boolean }) => Promise<string>;

/**
 * A command that ended badly. `message` carries the last lines it printed
 * and goes to the owner, in the admin. `publicMessage` is what may be
 * written to the public log: for a quiet command, only that it failed.
 */
export class CommandError extends Error {
  readonly publicMessage: string;
  constructor(summary: string, detail: string, quiet: boolean) {
    super(detail ? `${summary}\n${detail}` : summary);
    this.publicMessage = quiet ? summary : this.message;
  }
}

// The Vercel CLI prints the account's name and each deployment's address.
const QUIET = { quiet: true } as const;

/**
 * Builds the site the way Vercel would, into `.vercel/output`, leaving the
 * same `dist` folder the site's build checks read. The Vercel CLI takes the
 * token and the project from VERCEL_TOKEN, VERCEL_ORG_ID and
 * VERCEL_PROJECT_ID in the environment.
 */
export async function buildForVercel(exec: Exec, target: Target): Promise<void> {
  await exec("vercel", ["pull", "--yes", `--environment=${target}`], QUIET);
  await exec("vercel", target === "production" ? ["build", "--prod"] : ["build"], QUIET);
}

/** Uploads what `buildForVercel` built and answers with the address it was deployed to. */
export async function deployPrebuilt(exec: Exec, target: Target): Promise<string> {
  const output = await exec("vercel", target === "production" ? ["deploy", "--prebuilt", "--prod"] : ["deploy", "--prebuilt"], QUIET);
  const url = output.split(/\s+/).filter((word) => word.startsWith("https://")).pop();
  if (!url) throw new Error("Vercel did not say where it deployed.");
  return url;
}

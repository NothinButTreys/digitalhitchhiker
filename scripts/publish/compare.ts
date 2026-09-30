import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";

const run = promisify(execFile);
const SETS = "content/sets";
const EXACT = ["public/photos", "src/data/manifest.json", "content/set-order.json"];

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/** A set's content with each photograph's `source` left out: the one field allowed to differ. */
function withoutSources(raw: string): unknown {
  const parsed = JSON.parse(raw) as { photos?: Record<string, unknown>[] };
  for (const photo of parsed.photos ?? []) delete photo.source;
  return parsed;
}

/**
 * How the files in the working folder differ from the ones committed, for
 * the one-time check that a publish from the library reproduces the site
 * exactly. Images, the manifest, and the order must match byte for byte;
 * set files must match in everything but the originals' recorded names.
 * Null when nothing is committed to compare with, which is how things stand
 * once the library has taken over. Every line names a public path only.
 */
export async function compareToCommitted(root: string): Promise<string[] | null> {
  const committedSets = (await git(root, ["ls-files", "--", SETS])).split("\n").filter((file) => file.endsWith(".json"));
  if (committedSets.length === 0) return null;

  const differences: string[] = [];

  const status = await git(root, ["status", "--porcelain", "--untracked-files=all", "--", ...EXACT]);
  for (const line of status.split("\n").filter(Boolean)) {
    const code = line.slice(0, 2);
    const file = line.slice(3);
    if (code === "??") differences.push(`${file} is new`);
    else if (code.includes("D")) differences.push(`${file} is missing`);
    else differences.push(`${file} differs`);
  }

  const present = (await git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "--", SETS]))
    .split("\n")
    .filter((file) => file.endsWith(".json"));
  for (const file of [...new Set([...committedSets, ...present])]) {
    const committed = committedSets.includes(file) ? await git(root, ["show", `HEAD:${file}`]) : null;
    const generated = await readFile(path.join(root, file), "utf8").catch(() => null);
    if (committed === null) differences.push(`${file} is new`);
    else if (generated === null) differences.push(`${file} is missing`);
    else if (!isDeepStrictEqual(withoutSources(committed), withoutSources(generated))) differences.push(`${file} differs`);
  }

  return differences.sort();
}

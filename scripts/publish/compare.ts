import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";

const run = promisify(execFile);
const SETS = "content/sets";
const ORDER = "content/set-order.json";
const MANIFEST = "src/data/manifest.json";
const PHOTOS = "public/photos";

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

const committed = (root: string, file: string) => git(root, ["show", `HEAD:${file}`]).catch(() => null);
const generated = (root: string, file: string) => readFile(path.join(root, file), "utf8").catch(() => null);

type Photo = Record<string, unknown>;
type SetFile = { photos?: Photo[] } & Record<string, unknown>;

/** A set's content with each photograph's `source` left out: the one field allowed to differ. */
function withoutSources(raw: string): SetFile {
  const parsed = JSON.parse(raw) as SetFile;
  for (const photo of parsed.photos ?? []) delete photo.source;
  return parsed;
}

/** True when every item of `part` appears in `whole`, in the same order. */
function inOrderWithin(part: unknown[], whole: unknown[]): boolean {
  let from = 0;
  for (const item of part) {
    const at = whole.findIndex((candidate, index) => index >= from && isDeepStrictEqual(candidate, item));
    if (at === -1) return false;
    from = at + 1;
  }
  return true;
}

/**
 * For the one-time check before the library takes over: is what a publish
 * generated a faithful part of the site as it is committed?
 *
 * The library may show fewer photographs than the site does (it shows at
 * most eight in a category), so a committed photograph or set that was not
 * generated is fine. Everything that WAS generated must match what is
 * committed: every image byte for byte, every manifest entry, every set's
 * title, place and description, each photograph's text, and the order of
 * the sets and of the photographs within them. Only the originals' recorded
 * names may differ.
 *
 * Null when nothing is committed to compare with, which is how things stand
 * once the library has taken over. Every line names a public path only.
 */
export async function compareToCommitted(root: string): Promise<string[] | null> {
  const committedSets = (await git(root, ["ls-files", "--", SETS])).split("\n").filter((file) => file.endsWith(".json"));
  if (committedSets.length === 0) return null;

  const differences: string[] = [];

  // Images: git re-hashes any file that was rewritten, so a changed image is
  // caught whatever its size or date. A deleted one is a photograph no longer shown.
  const status = await git(root, ["status", "--porcelain", "--untracked-files=all", "--", PHOTOS]);
  for (const line of status.split("\n").filter(Boolean)) {
    const code = line.slice(0, 2);
    const file = line.slice(3);
    if (code === "??") differences.push(`${file} is new`);
    else if (!code.includes("D")) differences.push(`${file} differs`);
  }

  // The manifest: every generated entry must be a committed one, unchanged.
  const was = JSON.parse((await committed(root, MANIFEST)) ?? "{}") as Record<string, unknown>;
  const now = JSON.parse((await generated(root, MANIFEST)) ?? "{}") as Record<string, unknown>;
  const manifestMatches = Object.entries(now).every(([key, entry]) => isDeepStrictEqual(was[key], entry));
  if (!manifestMatches) differences.push(`${MANIFEST} differs`);

  // The order: the committed order, with only the sets no longer shown left out.
  const orderWas = JSON.parse((await committed(root, ORDER)) ?? "[]") as string[];
  const orderNow = JSON.parse((await generated(root, ORDER)) ?? "[]") as string[];
  if (!isDeepStrictEqual(orderNow, orderWas.filter((slug) => orderNow.includes(slug)))) differences.push(`${ORDER} differs`);

  // Each generated set: the same set, showing some of its photographs in the same order.
  const present = (await git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "--", SETS]))
    .split("\n")
    .filter((file) => file.endsWith(".json"));
  for (const file of present) {
    const now = await generated(root, file);
    if (now === null) continue; // Committed but not generated: a set no longer shown.
    const was = committedSets.includes(file) ? await committed(root, file) : null;
    if (was === null) {
      differences.push(`${file} is new`);
      continue;
    }
    const { photos: photosWas = [], ...restWas } = withoutSources(was);
    const { photos: photosNow = [], ...restNow } = withoutSources(now);
    if (!isDeepStrictEqual(restWas, restNow) || !inOrderWithin(photosNow, photosWas)) differences.push(`${file} differs`);
  }

  return differences.sort();
}

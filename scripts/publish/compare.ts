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

/** True when every photograph in `part` is, text and all, one of the photographs in `whole`. */
function allAmong(part: Photo[], whole: Photo[]): boolean {
  return part.every((photo) => whole.some((candidate) => isDeepStrictEqual(candidate, photo)));
}

/**
 * For the one-time check before the library takes over: is what a publish
 * generated a faithful part of the site as it is committed?
 *
 * Which photographs are shown, and in what order, is the owner's to choose
 * in the library, and the library shows at most eight in a category. So a
 * committed photograph or set that was not generated is fine, and so is a
 * different order of sets or of photographs within a set. What is checked is
 * that nothing was altered on the way through: every generated image must
 * match the committed one byte for byte, every manifest entry must be the
 * committed one, every set must keep its title, place and description, and
 * every photograph must keep its address and text. Only the originals'
 * recorded names may differ.
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

  // The order: any order of sets the site already has, each named once.
  const orderWas = JSON.parse((await committed(root, ORDER)) ?? "[]") as string[];
  const orderNow = JSON.parse((await generated(root, ORDER)) ?? "[]") as string[];
  const knownOnce = orderNow.every((slug) => orderWas.includes(slug)) && new Set(orderNow).size === orderNow.length;
  if (!knownOnce) differences.push(`${ORDER} differs`);

  // Each generated set: the same set, showing some of its photographs, unaltered, in any order.
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
    if (!isDeepStrictEqual(restWas, restNow) || !allAmong(photosNow, photosWas)) differences.push(`${file} differs`);
  }

  return differences.sort();
}

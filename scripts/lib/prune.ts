import { readdir, unlink } from "node:fs/promises";
import path from "node:path";

const PHOTOS_DIR = "public/photos";

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function regularFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      // Links are neither followed nor removed, so nothing outside can be reached.
      if (entry.isDirectory()) return regularFiles(full);
      return entry.isFile() ? [full] : [];
    }),
  );
  return nested.flat();
}

/**
 * Deletes every regular file under `<repoRoot>/public/photos` whose
 * repository-relative path is not in `expected`, and returns those paths.
 * Only files inside that folder are ever considered.
 */
export async function removeUnexpected(repoRoot: string, expected: Set<string>): Promise<string[]> {
  const root = path.resolve(repoRoot);
  const photos = path.resolve(root, PHOTOS_DIR);
  const removed: string[] = [];
  for (const file of await regularFiles(photos)) {
    const resolved = path.resolve(file);
    if (!inside(photos, resolved)) throw new Error(`refusing to remove ${resolved}: outside ${photos}`);
    const relative = path.relative(root, resolved).split(path.sep).join("/");
    if (expected.has(relative)) continue;
    await unlink(resolved);
    removed.push(relative);
  }
  return removed.sort();
}

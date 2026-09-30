import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { parseManifest, parseSetContent, parseSetOrder } from "../../src/data/schema";
import { measure, readable } from "../lib/encode";
import { planMigration, toSql, type MigrationPlan, type OriginalFile } from "./plan";

const run = promisify(execFile);
const ORIGINALS = process.env.DH_ORIGINALS ?? path.join(os.homedir(), "Pictures/Digital Hitchhiker/Originals");
const DATABASE = "digital-hitchhiker";
const BUCKET = "digital-hitchhiker-library";
const ADMIN = path.resolve("admin");
const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".heic": "image/heic", ".heif": "image/heif" };
const PREVIEW_EDGE = 1600;
const AT_ONCE = 4;

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function readOriginals(tmpDir: string): Promise<OriginalFile[]> {
  const found: OriginalFile[] = [];
  for (const folder of (await readdir(ORIGINALS, { withFileTypes: true })).filter((entry) => entry.isDirectory())) {
    for (const name of await readdir(path.join(ORIGINALS, folder.name))) {
      const contentType = TYPES[path.extname(name).toLowerCase()];
      if (!contentType) continue;
      const file = path.join(ORIGINALS, folder.name, name);
      const size = await measure(await readable(file, tmpDir));
      if (!size) throw new Error(`cannot read the dimensions of ${folder.name}/${name}`);
      found.push({ relativePath: `${folder.name}/${name}`, hash: await sha256(file), ...size, contentType });
    }
  }
  return found;
}

async function wrangler(args: string[]): Promise<string> {
  const { stdout } = await run("npx", ["wrangler", ...args], { cwd: ADMIN, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

const put = (key: string, file: string, contentType: string) =>
  wrangler(["r2", "object", "put", `${BUCKET}/${key}`, "--file", file, "--content-type", contentType, "--remote"]);

async function inBatches<T>(items: T[], action: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await action(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, worker));
}

async function remoteCount(table: string): Promise<number> {
  const out = await wrangler(["d1", "execute", DATABASE, "--remote", "--json", "--command", `SELECT COUNT(*) AS n FROM ${table}`]);
  return (JSON.parse(out) as { results: { n: number }[] }[])[0]!.results[0]!.n;
}

async function apply(plan: MigrationPlan, tmpDir: string): Promise<void> {
  // The library must be empty: this script only ever fills an empty one.
  const existing = (await remoteCount("categories")) + (await remoteCount("photos"));
  if (existing > 0) {
    throw new Error("The library already holds categories or photographs. Delete them in the admin first; this only fills an empty library.");
  }

  let done = 0;
  const tick = (what: string, total: number) => {
    done += 1;
    if (done % 20 === 0 || done === total) console.log(`${what}: ${done} of ${total}`);
  };

  // Files first, records last: until the records are written the admin shows
  // nothing, and a run that stops here can simply be started again.
  done = 0;
  await inBatches(plan.photos, async (photo) => {
    const source = path.join(ORIGINALS, photo.relativePath);
    await put(photo.originalKey, source, photo.contentType);
    const preview = path.join(tmpDir, `${photo.id}.jpg`);
    await sharp(await readable(source, tmpDir))
      .rotate()
      .resize({ width: PREVIEW_EDGE, height: PREVIEW_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toFile(preview);
    await put(photo.previewKey, preview, "image/jpeg");
    tick("Originals and previews", plan.photos.length);
  });

  done = 0;
  await inBatches(plan.derived, async (item) => {
    await put(item.key, item.from, item.key.endsWith(".avif") ? "image/avif" : "image/jpeg");
    tick("Generated images", plan.derived.length);
  });

  // Each entry goes in after its images, so an entry in the cache means the images are there.
  done = 0;
  await inBatches(plan.metas, async (item, index) => {
    const file = path.join(tmpDir, `meta-${index}.json`);
    await writeFile(file, JSON.stringify(item.entry));
    await put(item.key, file, "application/json");
    tick("Cache entries", plan.metas.length);
  });

  const sqlFile = path.join(tmpDir, "migration.sql");
  await writeFile(sqlFile, toSql(plan, new Date()));
  await wrangler(["d1", "execute", DATABASE, "--remote", "--file", sqlFile, "--yes"]);

  const [categories, photos] = [await remoteCount("categories"), await remoteCount("photos")];
  if (categories !== plan.categories.length || photos !== plan.photos.length) {
    throw new Error(`The library now holds ${categories} categories and ${photos} photographs, not the ${plan.categories.length} and ${plan.photos.length} expected.`);
  }
  console.log(`Done: ${categories} categories and ${photos} photographs are in the library.`);
}

async function main(): Promise<void> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "dh-migrate-"));
  try {
    const order = parseSetOrder(JSON.parse(await readFile("content/set-order.json", "utf8")));
    const sets = await Promise.all(
      order.map(async (slug) => {
        const file = `content/sets/${slug}.json`;
        return parseSetContent(JSON.parse(await readFile(file, "utf8")), file);
      }),
    );
    const manifest = parseManifest(JSON.parse(await readFile("src/data/manifest.json", "utf8")));

    console.log("Reading the originals…");
    const originals = await readOriginals(tmpDir);
    const plan = planMigration({ originals, sets, order, manifest });

    for (const item of plan.derived) await stat(item.from);

    const shown = plan.photos.filter((photo) => photo.selected === 1).length;
    console.log(`${plan.categories.length} categories`);
    console.log(`${plan.photos.length} photographs: ${shown} shown with their text, ${plan.photos.length - shown} unshown and needing text`);
    console.log(`${plan.derived.length} existing images and ${plan.metas.length} cache entries to seed`);
    for (const duplicate of plan.duplicates) console.log(`Left out, identical to ${duplicate.sameAs}: ${duplicate.relativePath}`);

    if (!process.argv.includes("--apply")) {
      console.log("Nothing was written. Run again with --apply to do it.");
      return;
    }
    await apply(plan, tmpDir);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

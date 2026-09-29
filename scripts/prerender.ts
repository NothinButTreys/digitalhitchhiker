import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { OutputFile } from "../src/entry-server";

type ServerBundle = { pages(template: string): OutputFile[]; extras(): OutputFile[] };

async function main() {
  const bundle = (await import(
    pathToFileURL(path.resolve("dist-server/entry-server.js")).href
  )) as ServerBundle;
  const template = await readFile("dist/index.html", "utf8");

  for (const marker of ["<!--head-->", "<!--app-->"]) {
    if (!template.includes(marker)) throw new Error(`dist/index.html is missing ${marker}`);
  }

  const outputs = [...bundle.pages(template), ...bundle.extras()];
  for (const { file, body } of outputs) {
    const target = path.join("dist", file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  }
  console.log(`prerendered ${outputs.length} files`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

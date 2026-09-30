import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
await mkdir(path.join(here, "out"), { recursive: true });

for (const [name, colour, width, height] of [
  ["desert.jpg", { r: 180, g: 90, b: 40 }, 2400, 1600],
  ["tower.jpg", { r: 40, g: 90, b: 180 }, 1200, 1800],
]) {
  await sharp({ create: { width, height, channels: 3, background: colour } })
    .jpeg({ quality: 80 })
    .toFile(path.join(here, "out", name));
}

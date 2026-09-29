import { buildCatalog } from "./catalog";
import manifest from "./manifest.json";
import { SITE } from "./site";

const files = import.meta.glob("../../content/sets/*.json", { eager: true, import: "default" });

export const catalog = buildCatalog({
  sets: Object.entries(files).map(([file, raw]) => ({ file: file.replace("../../", ""), raw })),
  manifest,
  order: SITE.setOrder,
});

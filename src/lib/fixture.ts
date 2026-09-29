import { buildCatalog } from "../data/catalog";

const entry = { width: 2000, height: 1333, widths: [640, 1280, 2000], color: "#112233" };
const photo = (slug: string) => ({
  slug,
  source: `s/${slug}.jpg`,
  title: slug,
  alt: slug,
  description: slug,
});

export const fixture = buildCatalog({
  sets: [
    { file: "a.json", raw: { slug: "desert", title: "Desert", place: "Arizona", description: "Desert set.", photos: [photo("one"), photo("two")] } },
    { file: "b.json", raw: { slug: "city", title: "City", place: "Québec", description: "City set.", photos: [photo("three")] } },
  ],
  manifest: { "desert/one": entry, "desert/two": entry, "city/three": entry },
  order: ["desert", "city"],
});

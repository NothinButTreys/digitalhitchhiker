import { describe, expect, it } from "vitest";
import type { Manifest, SetContent } from "../../src/data/schema";
import { MAX_SHOWN, idFromHash, planMigration, toSql, type OriginalFile } from "./plan";

const hash = (letter: string) => letter.repeat(64);
const original = (relativePath: string, letter: string, contentType = "image/jpeg"): OriginalFile => ({
  relativePath,
  hash: hash(letter),
  width: 3000,
  height: 2000,
  contentType,
});

const sets: SetContent[] = [
  {
    slug: "phoenix-zoo", title: "Phoenix Zoo", place: "Arizona", description: "Animals at the zoo.",
    photos: [
      { slug: "tiger", source: "Phoenix Zoo/zoo 2.jpg", title: "Tiger", alt: "A tiger resting", description: "A tiger's rest." },
      { slug: "egret", source: "Phoenix Zoo/zoo 1.jpg", title: "Egret", alt: "A white egret", description: "An egret." },
    ],
  },
  {
    slug: "montreal", title: "Montréal", place: "Québec", description: "Streets in winter.",
    photos: [{ slug: "icy-street", source: "Montreal/street.heic", title: "Icy street", alt: "An icy street", description: "Ice." }],
  },
];
const order = ["montreal", "phoenix-zoo"];
const entry = { width: 3000, height: 2000, widths: [640, 1280, 2000, 2880, 3000], color: "#112233" };
const manifest: Manifest = { "phoenix-zoo/tiger": entry, "phoenix-zoo/egret": entry, "montreal/icy-street": { ...entry, widths: [640] } };
const originals = [
  original("Phoenix Zoo/zoo 1.jpg", "a"),
  original("Phoenix Zoo/zoo 2.jpg", "b"),
  original("Phoenix Zoo/zoo 3.jpg", "c"),
  original("Montreal/street.heic", "d", "image/heic"),
];

const plan = () => planMigration({ originals, sets, order, manifest });

describe("idFromHash", () => {
  it("shapes the start of a hash like the ids the library uses", () => {
    expect(idFromHash("0123456789abcdef0123456789abcdef" + "f".repeat(32))).toBe("01234567-89ab-cdef-0123-456789abcdef");
  });
});

describe("planMigration", () => {
  it("makes the categories in the site's order, with stable ids", () => {
    const { categories } = plan();
    expect(categories.map((c) => [c.slug, c.title, c.place, c.position])).toEqual([
      ["montreal", "Montréal", "Québec", 1],
      ["phoenix-zoo", "Phoenix Zoo", "Arizona", 2],
    ]);
    expect(plan().categories.map((c) => c.id)).toEqual(categories.map((c) => c.id));
    expect(categories[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("carries a published photograph's text, slug and place in the order, shown and approved", () => {
    const { photos, categories } = plan();
    const zoo = categories.find((c) => c.slug === "phoenix-zoo")!;
    const tiger = photos.find((p) => p.slug === "tiger")!;
    expect(tiger).toMatchObject({
      id: idFromHash(hash("b")),
      categoryId: zoo.id,
      title: "Tiger",
      alt: "A tiger resting",
      description: "A tiger's rest.",
      textStatus: "approved",
      selected: 1,
      position: 1,
      originalKey: `originals/${idFromHash(hash("b"))}`,
      previewKey: `previews/${idFromHash(hash("b"))}.jpg`,
      originalName: "zoo 2.jpg",
      contentType: "image/jpeg",
      contentHash: hash("b"),
      width: 3000,
      height: 2000,
      relativePath: "Phoenix Zoo/zoo 2.jpg",
    });
    expect(photos.find((p) => p.slug === "egret")).toMatchObject({ selected: 1, position: 2 });
  });

  it("shows only the first eight of a set that shows more, keeping the others' text so they can be ticked later", () => {
    expect(MAX_SHOWN).toBe(8);
    const letters = "abcdefghij".split("");
    const big: SetContent = {
      slug: "desert", title: "Desert", place: "Arizona", description: "Dry places.",
      photos: letters.map((letter, index) => ({
        slug: `p-${index + 1}`, source: `Desert/${letter}.jpg`, title: `Title ${index + 1}`, alt: `Alt ${index + 1}`, description: `Description ${index + 1}.`,
      })),
    };
    const result = planMigration({
      originals: letters.map((letter) => original(`Desert/${letter}.jpg`, letter)),
      sets: [big],
      order: ["desert"],
      manifest: Object.fromEntries(letters.map((_, index) => [`desert/p-${index + 1}`, entry])),
    });
    expect(result.photos.map((p) => [p.slug, p.selected, p.position, p.textStatus])).toEqual([
      ["p-1", 1, 1, "approved"], ["p-2", 1, 2, "approved"], ["p-3", 1, 3, "approved"], ["p-4", 1, 4, "approved"],
      ["p-5", 1, 5, "approved"], ["p-6", 1, 6, "approved"], ["p-7", 1, 7, "approved"], ["p-8", 1, 8, "approved"],
      ["p-9", 0, 0, "approved"], ["p-10", 0, 0, "approved"],
    ]);
    expect(result.photos[9]).toMatchObject({ title: "Title 10", alt: "Alt 10", description: "Description 10." });
    // Their existing images are still seeded, so ticking one later encodes nothing.
    expect(result.metas).toHaveLength(10);
  });

  it("brings an unpublished original in unshown and needing its text, in its folder's category", () => {
    const { photos, categories } = plan();
    const extra = photos.find((p) => p.relativePath === "Phoenix Zoo/zoo 3.jpg")!;
    expect(extra).toMatchObject({
      categoryId: categories.find((c) => c.slug === "phoenix-zoo")!.id,
      slug: null,
      title: "",
      alt: "",
      description: "",
      textStatus: "needs_text",
      selected: 0,
      position: 0,
      originalName: "zoo 3.jpg",
    });
    expect(photos).toHaveLength(4);
  });

  it("seeds the cache with every existing image of every published photograph, and its manifest entry", () => {
    const { derived, metas } = plan();
    expect(derived.filter((d) => d.key.startsWith(`derived/${hash("d")}/`))).toEqual([
      { key: `derived/${hash("d")}/640.avif`, from: "public/photos/montreal/icy-street-640.avif" },
      { key: `derived/${hash("d")}/640.jpg`, from: "public/photos/montreal/icy-street-640.jpg" },
    ]);
    expect(derived.filter((d) => d.key.startsWith(`derived/${hash("b")}/`))).toHaveLength(8);
    expect(derived.some((d) => d.key.startsWith(`derived/${hash("c")}/`))).toBe(false);
    expect(metas).toContainEqual({ key: `derived/${hash("b")}/meta.json`, entry });
    expect(metas).toHaveLength(3);
  });

  it("keeps one of two identical files, preferring the published one, and says which was dropped", () => {
    const twice = [...originals, original("Phoenix Zoo/copy of zoo 2.jpg", "b"), original("Phoenix Zoo/aaa.jpg", "c")];
    const result = planMigration({ originals: twice, sets, order, manifest });
    expect(result.photos).toHaveLength(4);
    expect(result.photos.find((p) => p.contentHash === hash("b"))!.relativePath).toBe("Phoenix Zoo/zoo 2.jpg");
    expect(result.duplicates).toEqual([
      { relativePath: "Phoenix Zoo/copy of zoo 2.jpg", sameAs: "Phoenix Zoo/zoo 2.jpg" },
      { relativePath: "Phoenix Zoo/zoo 3.jpg", sameAs: "Phoenix Zoo/aaa.jpg" },
    ]);
  });

  it("stops when a published photograph's original is not there", () => {
    expect(() => planMigration({ originals: originals.slice(1), sets, order, manifest })).toThrow(
      'phoenix-zoo/egret: its original "Phoenix Zoo/zoo 1.jpg" was not found',
    );
  });

  it("stops when an original sits in a folder no category uses", () => {
    expect(() => planMigration({ originals: [...originals, original("Holiday/x.jpg", "e")], sets, order, manifest })).toThrow(
      'the folder "Holiday" does not belong to any category',
    );
  });

  it("stops when two categories use the same folder", () => {
    const shared: SetContent[] = [
      sets[0]!,
      { ...sets[1]!, photos: [{ ...sets[1]!.photos[0]!, source: "Phoenix Zoo/zoo 4.jpg" }] },
    ];
    expect(() => planMigration({ originals: [...originals, original("Phoenix Zoo/zoo 4.jpg", "e")], sets: shared, order, manifest })).toThrow(
      'the folder "Phoenix Zoo" is used by more than one category',
    );
  });

  it("stops when a published photograph has no manifest entry, or the order and the sets disagree", () => {
    expect(() => planMigration({ originals, sets, order, manifest: {} })).toThrow("phoenix-zoo/tiger: no entry in the manifest");
    expect(() => planMigration({ originals, sets, order: ["phoenix-zoo"], manifest })).toThrow('the set "montreal" is not in the order');
  });
});

describe("toSql", () => {
  it("skips rows that are already there, so a run can be finished by running it again", () => {
    const lines = toSql(plan(), new Date(Date.UTC(2026, 8, 30, 12))).trim().split("\n");
    expect(lines).toHaveLength(6);
    for (const line of lines) expect(line).toMatch(/^INSERT OR IGNORE INTO (categories|photos) /);
  });

  it("writes one insert per category and photograph, with quotes escaped and nulls as NULL", () => {
    const sql = toSql(plan(), new Date(Date.UTC(2026, 8, 30, 12)));
    const lines = sql.trim().split("\n");
    expect(lines.filter((line) => line.startsWith("INSERT OR IGNORE INTO categories"))).toHaveLength(2);
    expect(lines.filter((line) => line.startsWith("INSERT OR IGNORE INTO photos"))).toHaveLength(4);
    expect(sql).toContain("'A tiger''s rest.'");
    expect(sql).toContain("'Montréal'");
    expect(sql).toMatch(/INSERT OR IGNORE INTO photos .*VALUES \('[0-9a-f-]{36}', '[0-9a-f-]{36}', NULL, '', '', '', 'needs_text', 0, 0, /);
    expect(sql).toContain("'migration'");
    expect(sql).toContain("'2026-09-30T12:00:00.000Z'");
  });

  it("gives the unshown photographs of a category distinct, increasing times so the admin lists them in a steady order", () => {
    const more = [...originals, original("Phoenix Zoo/zoo 4.jpg", "e")];
    const sql = toSql(planMigration({ originals: more, sets, order, manifest }), new Date(Date.UTC(2026, 8, 30, 12)));
    const pairs = [...sql.matchAll(/'needs_text'.*'(2026-[^']+)', '(2026-[^']+)'\);/g)].map((match) => [match[1], match[2]]);
    expect(pairs).toHaveLength(2);
    const created = pairs.map((pair) => pair[0]!);
    expect(new Set(created).size).toBe(2);
    expect(created).toEqual([...created].sort());
    // A photograph is created and last updated at the same moment.
    for (const [first, second] of pairs) expect(second).toBe(first);
  });
});

import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalog } from "./index";
import { photoUrl, widthsFor } from "./photo-url";
import { SITE } from "./site";

describe("the real catalog", () => {
  it("loads every set in site order", () => {
    expect(catalog.sets.map((set) => set.slug)).toEqual([...SITE.setOrder]);
  });

  it("has every derivative file on disk", () => {
    const missing = catalog.sets
      .flatMap((set) => set.photos)
      .flatMap((photo) =>
        (["avif", "jpg"] as const).flatMap((ext) =>
          widthsFor(photo.widths, ext).map((width) => photoUrl(photo, width, ext)),
        ),
      )
      .filter((url) => !existsSync(`public${url}`));
    expect(missing).toEqual([]);
  });
});

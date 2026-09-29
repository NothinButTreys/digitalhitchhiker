import { describe, expect, it } from "vitest";
import { SITE } from "./site";

describe("SITE", () => {
  it("has an origin without a trailing slash", () => {
    expect(SITE.origin).toBe("https://digitalhitchhiker.photography");
  });

  it("lists five unique sets in display order", () => {
    expect(SITE.setOrder).toEqual([
      "superstition-mountains",
      "phoenix-zoo",
      "montreal",
      "the-scott",
      "salt-river",
    ]);
    expect(new Set(SITE.setOrder).size).toBe(SITE.setOrder.length);
  });

  it("uses the site's own contact details", () => {
    expect(SITE.email).toBe("digitalhitchhikers@gmail.com");
    expect(SITE.instagram).toBe("https://www.instagram.com/digitalhitchhiker/");
  });
});

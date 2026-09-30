import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SITE } from "./site";

describe("SITE", () => {
  it("has an origin without a trailing slash", () => {
    expect(SITE.origin).toBe("https://digitalhitchhiker.photography");
  });

  it("takes the order of the sets from the content folder", () => {
    const order = JSON.parse(readFileSync("content/set-order.json", "utf8")) as string[];
    expect(order.length).toBeGreaterThan(0);
    expect(SITE.setOrder).toEqual(order);
    expect(new Set(SITE.setOrder).size).toBe(SITE.setOrder.length);
  });

  it("uses the site's own contact details", () => {
    expect(SITE.email).toBe("digitalhitchhikers@gmail.com");
    expect(SITE.instagram).toBe("https://www.instagram.com/digitalhitchhiker/");
  });
});

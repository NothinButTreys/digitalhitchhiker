import setOrder from "../../content/set-order.json";

export const SITE = {
  name: "Digital Hitchhiker",
  origin: "https://digitalhitchhiker.photography",
  email: "digitalhitchhikers@gmail.com",
  instagram: "https://www.instagram.com/digitalhitchhiker/",
  description: "Photographs from the road: desert, city, river and wildlife.",
  /**
   * The sets in the order the site shows them, written by a publish (see
   * content/set-order.json). Checked when the catalog is built and in
   * site.test.ts, not here: this file is in the browser bundle.
   */
  setOrder: setOrder as readonly string[],
} as const;

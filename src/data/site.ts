import setOrder from "../../content/set-order.json";
import { parseSetOrder } from "./schema";

export const SITE = {
  name: "Digital Hitchhiker",
  origin: "https://digitalhitchhiker.photography",
  email: "digitalhitchhikers@gmail.com",
  instagram: "https://www.instagram.com/digitalhitchhiker/",
  description: "Photographs from the road: desert, city, river and wildlife.",
  /** The sets in the order the site shows them. Written by a publish; see content/set-order.json. */
  setOrder: parseSetOrder(setOrder) as readonly string[],
} as const;

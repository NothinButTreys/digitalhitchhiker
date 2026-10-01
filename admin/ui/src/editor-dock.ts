/**
 * Where a photograph's editor sits when there is room for it beside, or
 * under, the photographs: down the right, down the left, or along the bottom.
 * The owner moves it and it stays where it was put, on this device.
 */
export type Dock = "right" | "bottom" | "left";

const DOCKS: readonly Dock[] = ["right", "bottom", "left"];
const KEY = "dh:editor-dock";

const matches = (query: string) => typeof window.matchMedia === "function" && window.matchMedia(query).matches;

/**
 * True where the screen has room for the editor to sit beside the photographs
 * rather than over them: wide enough, and (a phone on its side is not) tall
 * enough to share. The stylesheet keeps the top bar in place on the same terms.
 */
export const canDock = () => matches("(min-width: 700px) and (min-height: 500px)");

/**
 * On a wide screen the right-hand side; on a narrower one, a tablet held
 * upright say, the bottom. A screen with little height has no room to give
 * up at the bottom, so there it is the side again.
 */
export const defaultDock = (): Dock => (matches("(min-width: 960px)") || matches("(max-height: 600px)") ? "right" : "bottom");

export function readDock(): Dock {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (DOCKS.includes(saved as Dock)) return saved as Dock;
  } catch {
    // Storage is unavailable; the panel starts in its usual place.
  }
  return defaultDock();
}

export function writeDock(dock: Dock): void {
  try {
    window.localStorage.setItem(KEY, dock);
  } catch {
    // Storage is unavailable; the panel will start in its usual place next time.
  }
}

/** The next place round: right, bottom, left, and back to the right. */
export const nextDock = (dock: Dock): Dock => DOCKS[(DOCKS.indexOf(dock) + 1) % DOCKS.length]!;

/** Where the panel would land if let go at this point of a window this size. */
export function dockAt(x: number, y: number, width: number, height: number): Dock {
  if (y > height * 0.62) return "bottom";
  return x < width / 2 ? "left" : "right";
}

export const DOCK_WORDS: Record<Dock, string> = { right: "on the right", bottom: "at the bottom", left: "on the left" };

import { afterEach, describe, expect, it } from "vitest";
import { canDock, defaultDock, dockAt, nextDock, readDock, writeDock } from "./editor-dock";

const media = (wide: (query: string) => boolean) => {
  window.matchMedia = ((query: string) => ({ matches: wide(query), media: query })) as unknown as typeof window.matchMedia;
};

afterEach(() => {
  window.localStorage.clear();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("where the editor panel sits", () => {
  it("docks only where there is room beside or under the photographs", () => {
    expect(canDock()).toBe(false);
    media(() => false);
    expect(canDock()).toBe(false);
    media((query) => query === "(min-width: 700px)");
    expect(canDock()).toBe(true);
  });

  it("starts on the right on a wide screen and at the bottom on a narrower one", () => {
    media(() => true);
    expect(defaultDock()).toBe("right");
    media((query) => query === "(min-width: 700px)");
    expect(defaultDock()).toBe("bottom");
    // A phone on its side: wide enough to dock, too short to give up its bottom half.
    media((query) => query === "(min-width: 700px)" || query === "(max-height: 600px)");
    expect(defaultDock()).toBe("right");
  });

  it("remembers where it was put", () => {
    media(() => true);
    expect(readDock()).toBe("right");
    writeDock("left");
    expect(readDock()).toBe("left");
  });

  it("ignores a remembered place it does not know", () => {
    media(() => true);
    window.localStorage.setItem("dh:editor-dock", "top");
    expect(readDock()).toBe("right");
  });

  it("goes round right, bottom, left when pressed", () => {
    expect([nextDock("right"), nextDock("bottom"), nextDock("left")]).toEqual(["bottom", "left", "right"]);
  });

  it("snaps to the bottom when dropped low, else to the nearer side", () => {
    const at = (x: number, y: number) => dockAt(x, y, 1000, 800);
    expect(at(900, 100)).toBe("right");
    expect(at(100, 100)).toBe("left");
    expect(at(500, 700)).toBe("bottom");
    expect(at(40, 700)).toBe("bottom");
    expect(at(499, 400)).toBe("left");
    expect(at(500, 400)).toBe("right");
  });
});

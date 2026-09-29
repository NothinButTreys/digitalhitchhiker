import { describe, expect, it } from "vitest";
import { clampIndex, formatCounter, nearestIndex } from "./strip-math";

describe("nearestIndex", () => {
  const offsets = [0, 1000, 1800, 2900];
  const roomy = 5000;

  it("returns the first frame at the start", () => {
    expect(nearestIndex(offsets, 0, roomy)).toBe(0);
  });

  it("returns the frame whose leading edge is closest", () => {
    expect(nearestIndex(offsets, 480, roomy)).toBe(0);
    expect(nearestIndex(offsets, 520, roomy)).toBe(1);
    expect(nearestIndex(offsets, 1790, roomy)).toBe(2);
  });

  it("returns the last frame when scrolled past it", () => {
    expect(nearestIndex(offsets, 5000, roomy)).toBe(3);
  });

  it("returns 0 for an empty strip", () => {
    expect(nearestIndex([], 100, roomy)).toBe(0);
  });

  describe("when the strip cannot scroll as far as the last frame", () => {
    const maxScroll = 2400;

    it("returns the last frame at the end of the strip", () => {
      expect(nearestIndex(offsets, 2400, maxScroll)).toBe(3);
    });

    it("still returns the nearest frame before the end", () => {
      expect(nearestIndex(offsets, 1850, maxScroll)).toBe(2);
    });

    it("returns the first frame at the start", () => {
      expect(nearestIndex(offsets, 0, maxScroll)).toBe(0);
    });

    it("returns the last frame even when an earlier frame's edge is nearer the end", () => {
      expect(nearestIndex([0, 1000, 1800, 3100], 2400, maxScroll)).toBe(3);
    });

    it("prefers the highest of several frames clamped to the end", () => {
      expect(nearestIndex([0, 1000, 2600, 2900], 2400, maxScroll)).toBe(3);
    });
  });

  describe("when the strip cannot scroll at all", () => {
    it("returns 0 regardless of the candidates or position", () => {
      expect(nearestIndex([0], 0, 0)).toBe(0);
      expect(nearestIndex([0, 500, 900], 0, 0)).toBe(0);
      expect(nearestIndex([0, 500, 900], 0, -10)).toBe(0);
    });
  });
});

describe("formatCounter", () => {
  it("pads both numbers to two digits", () => {
    expect(formatCounter(0, 8)).toBe("01 / 08");
    expect(formatCounter(11, 12)).toBe("12 / 12");
  });
});

describe("clampIndex", () => {
  it("keeps the index inside the strip", () => {
    expect(clampIndex(-1, 5)).toBe(0);
    expect(clampIndex(2, 5)).toBe(2);
    expect(clampIndex(9, 5)).toBe(4);
  });
});

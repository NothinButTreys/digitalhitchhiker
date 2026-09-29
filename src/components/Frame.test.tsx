// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { Photo } from "../data/catalog";
import { Frame } from "./Frame";

afterEach(cleanup);

const photo: Photo = {
  slug: "tiger",
  setSlug: "phoenix-zoo",
  index: 0,
  title: "Tiger",
  alt: "A tiger resting",
  description: "A tiger at rest.",
  width: 2000,
  height: 1333,
  widths: [640, 1280, 2000],
  color: "#3a2f1c",
};

function renderFrame(position: number) {
  return render(
    <MemoryRouter>
      <Frame photo={photo} position={position} />
    </MemoryRouter>,
  ).container;
}

describe("Frame", () => {
  it("links to the photo page and carries the photo slug as its id", () => {
    const link = renderFrame(0).querySelector("a");
    expect(link?.getAttribute("href")).toBe("/phoenix-zoo/tiger");
    expect(link?.id).toBe("tiger");
    expect(link?.hasAttribute("data-frame")).toBe(true);
  });

  it("renders AVIF and JPEG sources with explicit dimensions and alt text", () => {
    const container = renderFrame(0);
    const source = container.querySelector("source");
    const img = container.querySelector("img");
    expect(source?.getAttribute("type")).toBe("image/avif");
    expect(source?.getAttribute("srcset")).toContain("/photos/phoenix-zoo/tiger-1280.avif 1280w");
    expect(img?.getAttribute("srcset")).toContain("/photos/phoenix-zoo/tiger-2000.jpg 2000w");
    expect(img?.getAttribute("src")).toBe("/photos/phoenix-zoo/tiger-1280.jpg");
    expect(img?.getAttribute("alt")).toBe("A tiger resting");
    expect(img?.getAttribute("width")).toBe("2000");
    expect(img?.getAttribute("height")).toBe("1333");
  });

  it("sizes the image from the strip height on desktop and full width on phones", () => {
    const img = renderFrame(0).querySelector("img");
    expect(img?.getAttribute("sizes")).toBe(
      "(min-width: 768px) and (min-height: 541px) calc((100vh - 180px) * 1.5), 100vw",
    );
  });

  it("loads the first frame with high priority", () => {
    const img = renderFrame(0).querySelector("img");
    expect(img?.getAttribute("loading")).toBe("eager");
    expect(img?.getAttribute("fetchpriority")).toBe("high");
  });

  it("loads the second frame eagerly without high priority", () => {
    const img = renderFrame(1).querySelector("img");
    expect(img?.getAttribute("loading")).toBe("eager");
    expect(img?.hasAttribute("fetchpriority")).toBe(false);
  });

  it("lazy-loads later frames", () => {
    const img = renderFrame(2).querySelector("img");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("decoding")).toBe("async");
  });
});

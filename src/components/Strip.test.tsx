// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { resolve } from "../lib/routes";
import { fixture } from "../lib/fixture";
import { Strip } from "./Strip";

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
});
afterEach(cleanup);

function renderStrip() {
  const desert = resolve(fixture, "/desert");
  const city = resolve(fixture, "/city");
  if (desert.kind !== "set" || city.kind !== "set") throw new Error("fixture broken");
  return render(
    <MemoryRouter>
      <Strip set={desert.set} next={city.set} />
    </MemoryRouter>,
  ).container;
}

describe("Strip", () => {
  it("renders a labelled, focusable scroll region", () => {
    renderStrip();
    const region = screen.getByRole("region", { name: "Desert photographs" });
    expect(region.getAttribute("tabindex")).toBe("0");
  });

  it("renders one frame per photograph in order", () => {
    const frames = [...renderStrip().querySelectorAll("[data-frame]")];
    expect(frames.map((frame) => frame.id)).toEqual(["one", "two"]);
  });

  it("ends with a link to the next set", () => {
    renderStrip();
    const link = screen.getByRole("link", { name: "Next set: City" });
    expect(link.getAttribute("href")).toBe("/city");
  });

  it("starts the counter at the first photograph", () => {
    renderStrip();
    const counter = screen.getByTestId("counter");
    expect(counter.textContent).toContain("01 / 02");
    expect(counter.textContent).toContain("Photograph 1 of 2");
    expect(counter.getAttribute("aria-live")).toBe("polite");
  });

  it("names the set and place in the footer and in the phone heading", () => {
    const container = renderStrip();
    expect(container.querySelector("footer h1")?.textContent).toBe("Desert");
    expect(container.querySelector("footer")?.textContent).toContain("Arizona");
    expect(container.querySelector(".set-heading h1")?.textContent).toBe("Desert");
  });

  it("has labelled previous and next buttons", () => {
    renderStrip();
    expect(screen.getByRole("button", { name: "Previous photograph" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next photograph" })).toBeTruthy();
  });
});

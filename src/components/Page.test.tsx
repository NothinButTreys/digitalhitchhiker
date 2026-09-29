// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { fixture } from "../lib/fixture";
import { Page } from "./Page";

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
});
afterEach(cleanup);

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Page catalog={fixture} />
    </MemoryRouter>,
  ).container;
}

describe("Page", () => {
  it("renders the first set at the root and sets the document title", () => {
    renderAt("/");
    expect(screen.getByRole("region", { name: "Desert photographs" })).toBeTruthy();
    expect(document.title).toBe("Digital Hitchhiker — Photographs");
  });

  it("renders a photo page", () => {
    renderAt("/city/three");
    expect(screen.getByRole("article")).toBeTruthy();
    expect(document.title).toBe("three — City — Digital Hitchhiker");
  });

  it("renders the colophon with contact links", () => {
    renderAt("/colophon");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Colophon");
    expect(screen.getByRole("link", { name: "digitalhitchhikers@gmail.com" }).getAttribute("href")).toBe(
      "mailto:digitalhitchhikers@gmail.com",
    );
    expect(screen.getByRole("link", { name: "Instagram" }).getAttribute("href")).toBe(
      "https://www.instagram.com/digitalhitchhiker/",
    );
  });

  it("renders not found with a way back", () => {
    renderAt("/nope");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Not found");
    expect(screen.getByRole("link", { name: "See the photographs" }).getAttribute("href")).toBe("/desert");
  });

  it("has a skip link, a banner, one main landmark, and set navigation", () => {
    const container = renderAt("/city");
    expect(container.querySelector("a.skip")?.getAttribute("href")).toBe("#main");
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(container.querySelectorAll("main")).toHaveLength(1);
    const nav = screen.getByRole("navigation", { name: "Photo sets" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Desert", "City", "Colophon"]);
    expect(within(nav).getByRole("link", { name: "City" }).getAttribute("aria-current")).toBe("page");
  });

  it("toggles the phone menu", () => {
    renderAt("/city");
    const toggle = screen.getByRole("button", { name: "Photo sets" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes the menu on Escape and returns focus to the menu button", () => {
    renderAt("/city");
    const toggle = screen.getByRole("button", { name: "Photo sets" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(screen.getByRole("navigation", { name: "Photo sets" }), { key: "Escape" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });

  it("names only the site and its one contact address in the colophon", () => {
    const text = renderAt("/colophon").querySelector("article")?.textContent ?? "";
    expect(text).toContain("Digital Hitchhiker");
    expect(text).toContain("digitalhitchhikers@gmail.com");
    expect(text.split("@")).toHaveLength(2);
  });

  it("shows the mark beside the wordmark, hidden from assistive technology", () => {
    const container = renderAt("/city");
    const mark = container.querySelector(".wordmark svg.mark");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(mark?.getAttribute("viewBox")).toBe("0 0 32 32");
    expect(mark?.querySelectorAll("circle, path")).toHaveLength(3);
    expect(container.querySelector(".wordmark")?.textContent).toBe("Digital Hitchhiker");
  });
});

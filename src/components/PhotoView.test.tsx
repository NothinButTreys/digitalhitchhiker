// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "../lib/routes";
import { fixture } from "../lib/fixture";
import { PhotoView } from "./PhotoView";

afterEach(cleanup);

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.hash}`}</p>;
}

function renderPhoto(path: string) {
  const resolved = resolve(fixture, path);
  if (resolved.kind !== "photo") throw new Error("fixture broken");
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="*" element={<PhotoView set={resolved.set} photo={resolved.photo} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PhotoView", () => {
  it("shows the photograph with its title and description", () => {
    renderPhoto("/desert/one");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("one");
    expect(screen.getByRole("img").getAttribute("alt")).toBe("one");
    expect(screen.getByRole("img").getAttribute("sizes")).toBe(
      "(min-width: 768px) and (min-height: 541px) min(calc(100vw - 96px), calc((100vh - 204px) * 1.5)), 100vw",
    );
  });

  it("links back to the set at this photograph", () => {
    renderPhoto("/desert/two");
    expect(screen.getByRole("link", { name: "Back to Desert" }).getAttribute("href")).toBe(
      "/desert#two",
    );
  });

  it("links to the next photograph and omits previous on the first", () => {
    renderPhoto("/desert/one");
    expect(screen.getByRole("link", { name: "Next photograph" }).getAttribute("href")).toBe(
      "/desert/two",
    );
    expect(screen.queryByRole("link", { name: "Previous photograph" })).toBeNull();
  });

  it("omits next on the last photograph", () => {
    renderPhoto("/desert/two");
    expect(screen.queryByRole("link", { name: "Next photograph" })).toBeNull();
    expect(screen.getByRole("link", { name: "Previous photograph" }).getAttribute("href")).toBe(
      "/desert/one",
    );
  });

  it("closes on Escape", () => {
    renderPhoto("/desert/two");
    fireEvent.keyDown(screen.getByRole("article"), { key: "Escape" });
    expect(screen.getByTestId("where").textContent).toBe("/desert#two");
  });

  it("moves with the arrow keys", () => {
    renderPhoto("/desert/one");
    fireEvent.keyDown(screen.getByRole("article"), { key: "ArrowRight" });
    expect(screen.getByTestId("where").textContent).toBe("/desert/two");
  });
});

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Api } from "./api";
import { App } from "./App";
import type { CategoryOut, PhotoOut } from "./types";

afterEach(cleanup);

const zoo = { id: "zoo", title: "Phoenix Zoo", place: "Arizona" } as CategoryOut;
const river = { id: "river", title: "Salt River", place: "Arizona" } as CategoryOut;
const tiger = {
  id: "tiger", categoryId: "zoo", slug: "tiger", title: "Tiger", alt: "A tiger resting", description: "A tiger.",
  textStatus: "approved", selected: true, position: 1, originalName: "tiger.jpg", width: 3000, height: 2000,
  source: "upload", createdAt: "2026-09-29T00:00:00.000Z", previewUrl: "/api/photos/tiger/preview",
} as PhotoOut;

function GoTo({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      Go to {to}
    </button>
  );
}

describe("App", () => {
  it("starts a category screen afresh when moving to another category, never showing the previous one's photographs", async () => {
    let releaseRiver!: (photos: PhotoOut[]) => void;
    const listPhotos = vi.fn((categoryId: string) =>
      categoryId === "zoo" ? Promise.resolve([tiger]) : new Promise<PhotoOut[]>((resolve) => (releaseRiver = resolve)),
    );
    const api = { listCategories: vi.fn(async () => [zoo, river]), listPhotos } as unknown as Api;
    render(
      <MemoryRouter initialEntries={["/c/zoo"]}>
        <App api={api} />
        <GoTo to="/c/river" />
      </MemoryRouter>,
    );
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Phoenix Zoo");
    expect(screen.getByRole("img", { name: "A tiger resting" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Go to /c/river" }));

    expect(await screen.findByText("Loading…")).toBeTruthy();
    expect(screen.queryByRole("img", { name: "A tiger resting" })).toBeNull();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();

    releaseRiver([]);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Salt River");
    expect(within(screen.getByRole("region", { name: "Shown on the site" })).queryAllByRole("img")).toEqual([]);
  });
});

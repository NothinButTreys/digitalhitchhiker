import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Api } from "./api";
import { App } from "./App";
import type { CategoryOut, PhotoOut } from "./types";

afterEach(cleanup);

const zoo = { id: "zoo", title: "Phoenix Zoo", place: "Arizona", hidden: false } as CategoryOut;
const river = { id: "river", title: "Salt River", place: "Arizona", hidden: true } as CategoryOut;
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
    const api = { publishState: vi.fn(async () => ({ latest: null, published: null, unpublishedChanges: false, problems: [], summary: { categories: 0, photographs: 0 } })), listCategories: vi.fn(async () => [zoo, river]), listPhotos } as unknown as Api;
    render(
      <MemoryRouter initialEntries={["/c/zoo"]}>
        <App api={api} />
        <GoTo to="/c/river" />
      </MemoryRouter>,
    );
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Phoenix Zoo");
    expect(await screen.findByRole("img", { name: "A tiger resting" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Go to /c/river" }));

    // The category is already known, so its name shows at once; only its
    // photographs are still on their way.
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Salt River");
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByRole("img", { name: "A tiger resting" })).toBeNull();

    releaseRiver([]);
    const shown = await screen.findByRole("region", { name: "Shown on the site" });
    expect(within(shown).queryAllByRole("img")).toEqual([]);
  });

  it("links to every category from every screen and marks the current one", async () => {
    const api = { publishState: vi.fn(async () => ({ latest: null, published: null, unpublishedChanges: false, problems: [], summary: { categories: 0, photographs: 0 } })), listCategories: vi.fn(async () => [zoo, river]), listPhotos: vi.fn(async () => [tiger]) } as unknown as Api;
    render(
      <MemoryRouter initialEntries={["/c/zoo"]}>
        <App api={api} />
      </MemoryRouter>,
    );
    const nav = within(await screen.findByRole("navigation", { name: "Categories" }));
    expect(nav.getAllByRole("link")).toHaveLength(3);
    for (const [name, href, current] of [
      ["All categories", "/", null],
      ["Phoenix Zoo", "/c/zoo", "page"],
      ["Salt River (hidden)", "/c/river", null],
    ] as const) {
      const link = nav.getByRole("link", { name });
      expect([link.getAttribute("href"), link.getAttribute("aria-current")]).toEqual([href, current]);
    }
    expect(nav.getByRole("button", { name: "New category" })).toBeTruthy();
  });

  it("shows each category's cover and counts in the navigation without adding them to the link's name", async () => {
    const withCounts = [
      { ...zoo, coverUrl: "/api/photos/tiger/preview", photoCount: 27, selectedCount: 8 },
      { ...river, coverUrl: null, photoCount: 1, selectedCount: 0 },
    ] as CategoryOut[];
    const api = { publishState: vi.fn(async () => ({ latest: null, published: null, unpublishedChanges: false, problems: [], summary: { categories: 0, photographs: 0 } })), listCategories: vi.fn(async () => withCounts), listPhotos: vi.fn(async () => [tiger]) } as unknown as Api;
    render(
      <MemoryRouter initialEntries={["/c/zoo"]}>
        <App api={api} />
      </MemoryRouter>,
    );
    const nav = within(await screen.findByRole("navigation", { name: "Categories" }));
    const zooLink = nav.getByRole("link", { name: "Phoenix Zoo" });
    expect(zooLink.querySelector("img")?.getAttribute("src")).toBe("/api/photos/tiger/preview");
    expect(zooLink.querySelector("img")?.getAttribute("alt")).toBe("");
    expect(within(zooLink).getByText("27 photographs · 8 shown").getAttribute("aria-hidden")).toBe("true");
    const riverLink = nav.getByRole("link", { name: "Salt River (hidden)" });
    expect(riverLink.querySelector("img")).toBeNull();
    expect(within(riverLink).getByText("1 photograph · 0 shown")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Digital Hitchhiker · Library" }).getAttribute("href")).toBe("/");
  });

  it("creates a category from the navigation and goes straight into it", async () => {
    const lakes = { id: "lakes", title: "Forest Lakes", place: "Arizona", hidden: false } as CategoryOut;
    const createCategory = vi.fn(async () => lakes);
    // After the first load the list never answers again, so the new category
    // can only be known because creating it added it to the list.
    const api = {
      publishState: vi.fn(async () => ({ latest: null, published: null, unpublishedChanges: false, problems: [], summary: { categories: 0, photographs: 0 } })),
      listCategories: vi.fn().mockResolvedValueOnce([zoo, river]).mockReturnValue(new Promise(() => {})),
      listPhotos: vi.fn(async (categoryId: string) => (categoryId === "zoo" ? [tiger] : [])),
      createCategory,
    } as unknown as Api;
    render(
      <MemoryRouter initialEntries={["/c/zoo"]}>
        <App api={api} />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "New category" }));
    const dialog = within(screen.getByRole("dialog", { name: "New category" }));
    await userEvent.type(dialog.getByLabelText("Title"), "Forest Lakes");
    await userEvent.type(dialog.getByLabelText("Place"), "Arizona");
    await userEvent.type(dialog.getByLabelText("Description"), "Pines and water.");
    await userEvent.click(dialog.getByRole("button", { name: "Create category" }));

    expect(createCategory).toHaveBeenCalledWith({ title: "Forest Lakes", place: "Arizona", description: "Pines and water." });
    const heading = await screen.findByRole("heading", { level: 1, name: "Forest Lakes" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("No such category.")).toBeNull();
    expect(await screen.findByText("No photographs yet. Add some above.")).toBeTruthy();
    // Arriving on a new screen puts focus on its heading and names the tab.
    expect(document.activeElement).toBe(heading);
    expect(document.title).toBe("Forest Lakes — Library — Digital Hitchhiker");
  });

  it("creates a category from the library screen and goes straight into it", async () => {
    const lakes = { id: "lakes", title: "Forest Lakes", place: "Arizona", hidden: false } as CategoryOut;
    const api = {
      publishState: vi.fn(async () => ({ latest: null, published: null, unpublishedChanges: false, problems: [], summary: { categories: 0, photographs: 0 } })),
      listCategories: vi.fn().mockResolvedValueOnce([zoo, river]).mockReturnValue(new Promise(() => {})),
      listPhotos: vi.fn(async () => []),
      createCategory: vi.fn(async () => lakes),
    } as unknown as Api;
    render(
      <MemoryRouter>
        <App api={api} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Library" })).toBeTruthy();
    expect(document.title).toBe("Library — Digital Hitchhiker");
    await userEvent.click(within(screen.getByRole("main")).getByRole("button", { name: "New category" }));
    const dialog = within(screen.getByRole("dialog", { name: "New category" }));
    expect(document.activeElement).toBe(dialog.getByLabelText("Title"));
    await userEvent.type(dialog.getByLabelText("Title"), "Forest Lakes");
    await userEvent.type(dialog.getByLabelText("Place"), "Arizona");
    await userEvent.type(dialog.getByLabelText("Description"), "Pines and water.");
    await userEvent.click(dialog.getByRole("button", { name: "Create category" }));
    const heading = await screen.findByRole("heading", { level: 1, name: "Forest Lakes" });
    expect(screen.queryByText("No such category.")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it("shows no navigation until there is a category to go to", async () => {
    const api = { publishState: vi.fn(async () => ({ latest: null, published: null, unpublishedChanges: false, problems: [], summary: { categories: 0, photographs: 0 } })), listCategories: vi.fn(async () => []) } as unknown as Api;
    render(
      <MemoryRouter>
        <App api={api} />
      </MemoryRouter>,
    );
    expect(await screen.findByText("No categories yet. Create one to start uploading.")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Categories" })).toBeNull();
  });
});

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, type Api } from "../api";
import { LibraryProvider } from "../library";
import type { CategoryOut } from "../types";
import { CategoriesScreen } from "./CategoriesScreen";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const category = (overrides: Partial<CategoryOut>): CategoryOut => ({
  id: "c1",
  slug: "a",
  title: "A",
  place: "Arizona",
  description: "D",
  position: 1,
  hidden: false,
  photoCount: 0,
  selectedCount: 0,
  live: false,
  coverUrl: null,
  ...overrides,
});

const zoo = category({ id: "zoo", slug: "phoenix-zoo", title: "Phoenix Zoo", photoCount: 27, selectedCount: 6, live: true, position: 1, coverUrl: "/api/photos/tiger/preview" });
const river = category({ id: "river", title: "Salt River", photoCount: 34, position: 2 });
const scott = category({ id: "scott", title: "The Scott", photoCount: 12, selectedCount: 5, hidden: true, position: 3 });
const empty = category({ id: "empty", title: "Conventions", position: 4 });

function fakeApi(overrides: Partial<Api> = {}): Api {
  return {
    listCategories: vi.fn(async () => [zoo, river, scott, empty]),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    orderCategories: vi.fn(),
    deleteCategory: vi.fn(),
    ...overrides,
  } as Api;
}

function renderScreen(api: Api) {
  render(
    <MemoryRouter>
      <LibraryProvider api={api}>
        <Routes>
          <Route path="/" element={<CategoriesScreen api={api} />} />
          <Route path="/c/:categoryId" element={<p>Inside a category</p>} />
        </Routes>
      </LibraryProvider>
    </MemoryRouter>,
  );
}

const row = async (title: string) => (await screen.findByRole("link", { name: title })).closest("li")!;
const titles = () => screen.getAllByRole("listitem").map((item) => within(item).getByRole("link").textContent);

describe("CategoriesScreen", () => {
  it("shows loading, then each category with its cover, counts and one status", async () => {
    renderScreen(fakeApi());
    expect(screen.getByText("Loading…")).toBeTruthy();
    const zooRow = within(await row("Phoenix Zoo"));
    expect(zooRow.getByRole("link", { name: "Phoenix Zoo" }).getAttribute("href")).toBe("/c/zoo");
    expect(zooRow.getByText("27 photographs, 6 shown")).toBeTruthy();
    expect(zooRow.getByText("Live")).toBeTruthy();
    // Each card carries its place in the site's menu, for the eye only.
    const numbers = [...document.querySelectorAll(".row-number")];
    expect(numbers.map((number) => number.textContent)).toEqual(numbers.map((_, index) => String(index + 1).padStart(2, "0")));
    expect(numbers.length).toBeGreaterThan(1);
    expect(numbers.every((number) => number.getAttribute("aria-hidden") === "true")).toBe(true);
    // The cover is decoration beside the title, so it has no name of its own.
    expect((await row("Phoenix Zoo")).querySelector("img")?.getAttribute("src")).toBe("/api/photos/tiger/preview");
    expect((await row("Phoenix Zoo")).querySelector("img")?.getAttribute("alt")).toBe("");
    expect((await row("Salt River")).querySelector("img")).toBeNull();
    expect(within(await row("Salt River")).getByText("Not shown")).toBeTruthy();
    expect(within(await row("The Scott")).getByText("Hidden")).toBeTruthy();
    expect(within(await row("The Scott")).queryByText("Live")).toBeNull();
  });

  it("asks for the first category right on the screen when there are none, and goes into it once created", async () => {
    const created = category({ id: "new", title: "Forest Lakes" });
    const createCategory = vi.fn(async () => created);
    renderScreen(fakeApi({ listCategories: vi.fn(async () => []), createCategory } as Partial<Api>));
    expect(await screen.findByText("No categories yet. Create one to start uploading.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.type(screen.getByLabelText("Title"), "Forest Lakes");
    await userEvent.type(screen.getByLabelText("Place"), "Arizona");
    await userEvent.type(screen.getByLabelText("Description"), "Pines and water.");
    await userEvent.click(screen.getByRole("button", { name: "Create category" }));
    expect(createCategory).toHaveBeenCalledWith({ title: "Forest Lakes", place: "Arizona", description: "Pines and water." });
    expect(await screen.findByText("Inside a category")).toBeTruthy();
  });

  it("creates a category in a dialog and goes straight into it", async () => {
    const created = category({ id: "new", title: "Forest Lakes", position: 5 });
    const createCategory = vi.fn(async () => created);
    renderScreen(fakeApi({ createCategory } as Partial<Api>));
    await screen.findByRole("link", { name: "Phoenix Zoo" });
    await userEvent.click(screen.getByRole("button", { name: "New category" }));
    const dialog = within(screen.getByRole("dialog", { name: "New category" }));
    await userEvent.type(dialog.getByLabelText("Title"), "Forest Lakes");
    await userEvent.type(dialog.getByLabelText("Place"), "Arizona");
    await userEvent.type(dialog.getByLabelText("Description"), "Pines and water.");
    await userEvent.click(dialog.getByRole("button", { name: "Create category" }));
    expect(createCategory).toHaveBeenCalledWith({ title: "Forest Lakes", place: "Arizona", description: "Pines and water." });
    expect(await screen.findByText("Inside a category")).toBeTruthy();
  });

  it("shows the reason when creating fails and keeps what was typed", async () => {
    const createCategory = vi.fn(async () => {
      throw new ApiRequestError(409, "slug_taken", 'Another category already uses the address "forest-lakes".');
    });
    renderScreen(fakeApi({ createCategory } as Partial<Api>));
    await screen.findByRole("link", { name: "Phoenix Zoo" });
    await userEvent.click(screen.getByRole("button", { name: "New category" }));
    const dialog = within(screen.getByRole("dialog", { name: "New category" }));
    await userEvent.type(dialog.getByLabelText("Title"), "Forest Lakes");
    await userEvent.type(dialog.getByLabelText("Place"), "Arizona");
    await userEvent.type(dialog.getByLabelText("Description"), "Pines.");
    await userEvent.click(dialog.getByRole("button", { name: "Create category" }));
    expect((await dialog.findByRole("alert")).textContent).toContain("already uses the address");
    expect((dialog.getByLabelText("Title") as HTMLInputElement).value).toBe("Forest Lakes");
    expect(screen.queryByText("Inside a category")).toBeNull();
  });

  it("closes the new-category dialog on Close and returns focus to the button that opened it", async () => {
    const createCategory = vi.fn();
    renderScreen(fakeApi({ createCategory } as Partial<Api>));
    const opener = await screen.findByRole("button", { name: "New category" });
    await userEvent.click(opener);
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(createCategory).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  });

  it("gives every category a handle to reorder it by, named for the category", async () => {
    renderScreen(fakeApi());
    const handle = await screen.findByRole("button", { name: "Reorder Phoenix Zoo" });
    expect(handle.getAttribute("aria-roledescription")).toBe("sortable");
    expect(handle.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Reorder / })).toHaveLength(4);
  });

  it("moves a category without dragging, from its details, by sending the whole new order", async () => {
    const orderCategories = vi.fn(async () => [river, zoo, scott, empty]);
    renderScreen(fakeApi({ orderCategories } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Edit details of Phoenix Zoo" }));
    const dialog = within(screen.getByRole("dialog", { name: "Phoenix Zoo details" }));
    expect(dialog.getByText("Position 1 of 4 in the site's menu")).toBeTruthy();
    expect(dialog.getByRole("button", { name: "Move up" }).getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(dialog.getByRole("button", { name: "Move down" }));
    expect(orderCategories).toHaveBeenCalledWith(["river", "zoo", "scott", "empty"]);
    await waitFor(() => expect(titles().slice(0, 2)).toEqual(["Salt River", "Phoenix Zoo"]));
    expect(await dialog.findByText("Position 2 of 4 in the site's menu")).toBeTruthy();
    expect(document.activeElement).toBe(dialog.getByRole("button", { name: "Move down" }));
  });

  it("shows a new order at once, before the server has answered", async () => {
    let answer!: (list: CategoryOut[]) => void;
    const orderCategories = vi.fn(() => new Promise<CategoryOut[]>((resolve) => (answer = resolve)));
    renderScreen(fakeApi({ orderCategories } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Edit details of Phoenix Zoo" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Move down" }));
    expect(titles().slice(0, 2)).toEqual(["Salt River", "Phoenix Zoo"]);
    answer([river, zoo, scott, empty]);
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Move down" }).getAttribute("aria-disabled")).toBeNull());
    expect(titles().slice(0, 2)).toEqual(["Salt River", "Phoenix Zoo"]);
  });

  it("opens the details, where the move buttons are, when a handle is pressed rather than dragged", async () => {
    renderScreen(fakeApi());
    await userEvent.click(await screen.findByRole("button", { name: "Reorder Salt River" }));
    expect(within(screen.getByRole("dialog", { name: "Salt River details" })).getByRole("button", { name: "Move up" })).toBeTruthy();
  });

  it("does not let a list that was already on its way undo a change made since", async () => {
    let late!: (list: CategoryOut[]) => void;
    const listCategories = vi
      .fn()
      .mockResolvedValueOnce([zoo, river, scott, empty])
      .mockImplementationOnce(() => new Promise<CategoryOut[]>((resolve) => (late = resolve)));
    const deleteCategory = vi.fn(async () => undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = fakeApi({ listCategories, deleteCategory } as Partial<Api>);
    const view = (key: string) => (
      <MemoryRouter>
        <LibraryProvider api={api}>
          <CategoriesScreen key={key} api={api} />
        </LibraryProvider>
      </MemoryRouter>
    );
    const { rerender } = render(view("first"));
    await screen.findByRole("link", { name: "Conventions" });
    // Coming back to the screen asks for the list again; it is slow to arrive.
    rerender(view("second"));
    await waitFor(() => expect(listCategories).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole("button", { name: "Delete Conventions" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Conventions" })).toBeNull());
    // The slow list still includes the category that has since been deleted.
    late([zoo, river, scott, empty]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("link", { name: "Conventions" })).toBeNull();
  });

  it("puts the old order back when the server refuses the new one", async () => {
    const orderCategories = vi.fn(async () => {
      throw new ApiRequestError(409, "stale", "The categories changed. Reload and try again.");
    });
    renderScreen(fakeApi({ orderCategories } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Edit details of Phoenix Zoo" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Move down" }));
    expect((await screen.findAllByRole("alert"))[0]!.textContent).toContain("The categories changed");
    expect(titles().slice(0, 2)).toEqual(["Phoenix Zoo", "Salt River"]);
  });

  it("renames a category from its details and says its address stays the same", async () => {
    const renamed = { ...zoo, title: "The Zoo" };
    const updateCategory = vi.fn(async () => renamed);
    renderScreen(fakeApi({ updateCategory } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Edit details of Phoenix Zoo" }));
    const dialog = within(screen.getByRole("dialog", { name: "Phoenix Zoo details" }));
    expect(dialog.getByText("The address /phoenix-zoo was set when the category was created and does not change.")).toBeTruthy();
    await userEvent.clear(dialog.getByLabelText("Title"));
    await userEvent.type(dialog.getByLabelText("Title"), "The Zoo");
    await userEvent.click(dialog.getByRole("button", { name: "Save details" }));
    expect(updateCategory).toHaveBeenCalledWith("zoo", { title: "The Zoo", place: "Arizona", description: "D" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("link", { name: "The Zoo" })).toBeTruthy();
  });

  it("hides and shows", async () => {
    const updateCategory = vi.fn(async (_id: string, patch: { hidden?: boolean }) => ({ ...zoo, hidden: patch.hidden!, live: !patch.hidden }));
    renderScreen(fakeApi({ updateCategory } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Hide Phoenix Zoo" }));
    expect(updateCategory).toHaveBeenCalledWith("zoo", { hidden: true });
    expect(await screen.findByRole("button", { name: "Show Phoenix Zoo" })).toBeTruthy();
    expect(within(await row("Phoenix Zoo")).getByText("Hidden")).toBeTruthy();
    expect(screen.getByText("Phoenix Zoo is now hidden from the site.").getAttribute("role")).toBe("status");
    // The button was only waiting, never disabled, so it still has the focus.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Show Phoenix Zoo" }));
    expect(screen.getByRole("button", { name: "Show The Scott" })).toBeTruthy();
  });

  it("offers delete only for an empty category and asks first", async () => {
    const deleteCategory = vi.fn(async () => undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderScreen(fakeApi({ deleteCategory } as Partial<Api>));
    await screen.findByRole("link", { name: "Phoenix Zoo" });
    expect(screen.queryByRole("button", { name: "Delete Phoenix Zoo" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Delete Conventions" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(deleteCategory).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Delete Conventions" }));
    expect(deleteCategory).toHaveBeenCalledWith("empty");
    await waitFor(() => expect(screen.queryByRole("link", { name: "Conventions" })).toBeNull());
    expect(screen.getByText("Conventions was deleted.").getAttribute("role")).toBe("status");
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Library" }));
  });

  it("shows the reason when loading fails", async () => {
    renderScreen(
      fakeApi({
        listCategories: vi.fn(async () => {
          throw new ApiRequestError(0, "network", "Could not reach the library. Check your connection.");
        }),
      } as Partial<Api>),
    );
    expect((await screen.findByRole("alert")).textContent).toBe("Could not reach the library. Check your connection.");
  });

  it("offers a way forward when loading fails because the owner has been signed out", async () => {
    renderScreen(
      fakeApi({
        listCategories: vi.fn(async () => {
          throw new ApiRequestError(401, "signed_out", "You have been signed out. Reload the page to sign in again.");
        }),
      } as Partial<Api>),
    );
    expect((await screen.findByRole("alert")).textContent).toBe("You have been signed out. Reload the page to sign in again.");
    expect(screen.getByRole("button", { name: "Reload the page" })).toBeTruthy();
  });
});

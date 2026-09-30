import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, type Api } from "../api";
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
  ...overrides,
});

const zoo = category({ id: "zoo", title: "Phoenix Zoo", photoCount: 27, selectedCount: 6, live: true, position: 1 });
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
      <CategoriesScreen api={api} />
    </MemoryRouter>,
  );
}

const row = async (title: string) => (await screen.findByRole("link", { name: title })).closest("li")!;

describe("CategoriesScreen", () => {
  it("shows loading, then each category with counts and one status", async () => {
    renderScreen(fakeApi());
    expect(screen.getByText("Loading…")).toBeTruthy();
    const zooRow = within(await row("Phoenix Zoo"));
    expect(zooRow.getByRole("link", { name: "Phoenix Zoo" }).getAttribute("href")).toBe("/c/zoo");
    expect(zooRow.getByText("27 photographs, 6 selected")).toBeTruthy();
    expect(zooRow.getByText("Live")).toBeTruthy();
    expect(within(await row("Salt River")).getByText("Not shown")).toBeTruthy();
    expect(within(await row("The Scott")).getByText("Hidden")).toBeTruthy();
    expect(within(await row("The Scott")).queryByText("Live")).toBeNull();
  });

  it("says so when there are no categories", async () => {
    renderScreen(fakeApi({ listCategories: vi.fn(async () => []) } as Partial<Api>));
    expect(await screen.findByText("No categories yet. Create one to start uploading.")).toBeTruthy();
  });

  it("moves a category down by sending the whole new order", async () => {
    const orderCategories = vi.fn(async () => [river, zoo, scott, empty]);
    renderScreen(fakeApi({ orderCategories } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Move Phoenix Zoo down" }));
    expect(orderCategories).toHaveBeenCalledWith(["river", "zoo", "scott", "empty"]);
    await waitFor(() => {
      const titles = screen.getAllByRole("listitem").map((item) => within(item).getAllByRole("link")[0]!.textContent);
      expect(titles.slice(0, 2)).toEqual(["Salt River", "Phoenix Zoo"]);
    });
  });

  it("disables moving the first up and the last down", async () => {
    renderScreen(fakeApi());
    expect((await screen.findByRole("button", { name: "Move Phoenix Zoo up" })).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Move Conventions down" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Move Salt River up" }).hasAttribute("disabled")).toBe(false);
  });

  it("hides and shows", async () => {
    const updateCategory = vi.fn(async (_id: string, patch: { hidden?: boolean }) => ({ ...zoo, hidden: patch.hidden!, live: !patch.hidden }));
    renderScreen(fakeApi({ updateCategory } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Hide Phoenix Zoo" }));
    expect(updateCategory).toHaveBeenCalledWith("zoo", { hidden: true });
    expect(await screen.findByRole("button", { name: "Show Phoenix Zoo" })).toBeTruthy();
    expect(within(await row("Phoenix Zoo")).getByText("Hidden")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show The Scott" })).toBeTruthy();
  });

  it("creates a category and clears the form", async () => {
    const created = category({ id: "new", title: "Forest Lakes", position: 5 });
    const createCategory = vi.fn(async () => created);
    renderScreen(fakeApi({ createCategory } as Partial<Api>));
    await screen.findByRole("link", { name: "Phoenix Zoo" });
    await userEvent.type(screen.getByLabelText("Title"), "Forest Lakes");
    await userEvent.type(screen.getByLabelText("Place"), "Arizona");
    await userEvent.type(screen.getByLabelText("Description"), "Pines and water.");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(createCategory).toHaveBeenCalledWith({ title: "Forest Lakes", place: "Arizona", description: "Pines and water." });
    expect(await screen.findByRole("link", { name: "Forest Lakes" })).toBeTruthy();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("");
  });

  it("shows the reason when creating fails and keeps what was typed", async () => {
    const createCategory = vi.fn(async () => {
      throw new ApiRequestError(409, "slug_taken", 'Another category already uses the address "forest-lakes".');
    });
    renderScreen(fakeApi({ createCategory } as Partial<Api>));
    await screen.findByRole("link", { name: "Phoenix Zoo" });
    await userEvent.type(screen.getByLabelText("Title"), "Forest Lakes");
    await userEvent.type(screen.getByLabelText("Place"), "Arizona");
    await userEvent.type(screen.getByLabelText("Description"), "Pines.");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect((await screen.findByRole("alert")).textContent).toContain("already uses the address");
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Forest Lakes");
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

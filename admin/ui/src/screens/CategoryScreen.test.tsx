import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiRequestError, type Api } from "../api";
import type { CategoryOut, PhotoOut } from "../types";
import { CategoryScreen } from "./CategoryScreen";

// A real browser remembers the element focused when showModal() is called and,
// when the dialog is closed through close() (which covers Escape and a dialog
// form too), restores focus to it if it is still in the document. jsdom has no
// dialog behaviour at all, so these stubs imitate that faithfully.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    (this as unknown as { openedBy: Element | null }).openedBy = document.activeElement;
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    const opener = (this as unknown as { openedBy: Element | null }).openedBy;
    if (opener && document.contains(opener)) (opener as HTMLElement).focus();
    this.dispatchEvent(new Event("close"));
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const zoo = { id: "zoo", title: "Phoenix Zoo", place: "Arizona" } as CategoryOut;
const river = { id: "river", title: "Salt River", place: "Arizona" } as CategoryOut;

let counter = 0;
const photo = (overrides: Partial<PhotoOut>): PhotoOut => {
  counter += 1;
  const id = overrides.id ?? `p${counter}`;
  return {
    id,
    categoryId: "zoo",
    slug: null,
    title: "",
    alt: "",
    description: "",
    textStatus: "needs_text",
    selected: false,
    position: 0,
    originalName: `${id}.jpg`,
    width: 3000,
    height: 2000,
    source: "upload",
    createdAt: "2026-09-29T00:00:00.000Z",
    previewUrl: `/api/photos/${id}/preview`,
    ...overrides,
  };
};

const tiger = photo({ id: "tiger", title: "Tiger", alt: "A tiger resting", textStatus: "approved", selected: true, position: 1 });
const zebra = photo({ id: "zebra", title: "Zebra", alt: "A zebra grazing", textStatus: "approved", selected: true, position: 2 });
const egret = photo({ id: "egret", title: "Egret", alt: "A white egret", textStatus: "approved" });
const untitled = photo({ id: "untitled", textStatus: "needs_text" });
const anotherUntitled = photo({ id: "another-untitled", textStatus: "needs_text" });

function fakeApi(photos: PhotoOut[], overrides: Partial<Api> = {}): Api {
  return {
    listCategories: vi.fn(async () => [zoo, river]),
    listPhotos: vi.fn(async () => photos),
    setSelected: vi.fn(),
    orderSelection: vi.fn(),
    ...overrides,
  } as Api;
}

function renderAt(api: Api, id = "zoo") {
  render(
    <MemoryRouter initialEntries={[`/c/${id}`]}>
      <Routes>
        <Route path="/c/:categoryId" element={<CategoryScreen api={api} categoryId={id} />} />
      </Routes>
    </MemoryRouter>,
  );
}

const section = (name: string) => within(screen.getByRole("region", { name }));

describe("CategoryScreen", () => {
  it("shows the category, the count, and both sections", async () => {
    renderAt(fakeApi([tiger, zebra, egret, untitled, anotherUntitled]));
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Phoenix Zoo");
    expect(screen.getByText("2 of 8 selected. Aim for about six.")).toBeTruthy();

    const shown = section("Shown on the site");
    expect(shown.getAllByRole("img").map((img) => img.getAttribute("alt"))).toEqual(["A tiger resting", "A zebra grazing"]);

    const rest = section("Not shown");
    expect(rest.getByText("Ready")).toBeTruthy();
    expect(rest.getAllByText("Needs text")).toHaveLength(2);
    expect(rest.getAllByText("Untitled")).toHaveLength(2);
    expect(rest.getAllByRole("img", { name: "Untitled photograph" })).toHaveLength(2);
  });

  it("says so when nothing is selected", async () => {
    renderAt(fakeApi([egret]));
    expect(await screen.findByText("Nothing selected. This category is not on the site.")).toBeTruthy();
    expect(screen.getByText("0 of 8 selected. Aim for about six.")).toBeTruthy();
  });

  it("offers Show only for approved text", async () => {
    renderAt(fakeApi([egret, untitled, anotherUntitled]));
    expect(await screen.findByRole("button", { name: "Show Egret on the site" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Show Untitled/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Edit / }).map((button) => button.getAttribute("aria-label"))).toEqual([
      "Edit Egret",
      "Edit Untitled photograph 1",
      "Edit Untitled photograph 2",
    ]);
  });

  it("gives two untitled photographs different accessible names on their Edit buttons", async () => {
    renderAt(fakeApi([untitled, anotherUntitled]));
    const editButtons = await screen.findAllByRole("button", { name: /^Edit / });
    const names = editButtons.map((button) => button.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(["Edit Untitled photograph 1", "Edit Untitled photograph 2"]);
  });

  it("selects, then reloads from the server", async () => {
    const after = [tiger, zebra, { ...egret, selected: true, position: 3 }];
    const listPhotos = vi.fn().mockResolvedValueOnce([tiger, zebra, egret]).mockResolvedValueOnce(after);
    const setSelected = vi.fn(async () => after[2]!);
    renderAt(fakeApi([], { listPhotos, setSelected } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Show Egret on the site" }));
    expect(setSelected).toHaveBeenCalledWith("egret", true);
    await waitFor(() => expect(screen.getByText("3 of 8 selected. Aim for about six.")).toBeTruthy());
    expect(section("Shown on the site").getAllByRole("img")).toHaveLength(3);
  });

  it("removes from the site", async () => {
    const listPhotos = vi.fn().mockResolvedValueOnce([tiger, zebra]).mockResolvedValueOnce([{ ...zebra, position: 1 }, { ...tiger, selected: false, position: 0 }]);
    const setSelected = vi.fn(async () => tiger);
    renderAt(fakeApi([], { listPhotos, setSelected } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Remove Tiger from the site" }));
    expect(setSelected).toHaveBeenCalledWith("tiger", false);
    await waitFor(() => expect(screen.getByText("1 of 8 selected. Aim for about six.")).toBeTruthy());
  });

  it("reorders by sending the whole order", async () => {
    const orderSelection = vi.fn(async () => [{ ...zebra, position: 1 }, { ...tiger, position: 2 }]);
    renderAt(fakeApi([tiger, zebra], { orderSelection } as Partial<Api>));
    expect((await screen.findByRole("button", { name: "Move Tiger earlier" })).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Move Zebra later" }).hasAttribute("disabled")).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Move Tiger later" }));
    expect(orderSelection).toHaveBeenCalledWith("zoo", ["zebra", "tiger"]);
    await waitFor(() =>
      expect(section("Shown on the site").getAllByRole("img").map((img) => img.getAttribute("alt"))).toEqual(["A zebra grazing", "A tiger resting"]),
    );
  });

  it("after a reorder shows exactly the list the server returned, including a photograph added meanwhile", async () => {
    const arrived = photo({ id: "arrived", textStatus: "needs_text" });
    const orderSelection = vi.fn(async () => [{ ...zebra, position: 1 }, { ...tiger, position: 2 }, arrived, egret]);
    renderAt(fakeApi([tiger, zebra, egret], { orderSelection } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Move Tiger later" }));
    await waitFor(() =>
      expect(section("Shown on the site").getAllByRole("img").map((img) => img.getAttribute("alt"))).toEqual(["A zebra grazing", "A tiger resting"]),
    );
    expect(section("Not shown").getAllByRole("img").map((img) => img.getAttribute("alt"))).toEqual(["Untitled photograph", "A white egret"]);
  });

  it("stops offering Show at eight", async () => {
    const eight = Array.from({ length: 8 }, (_, index) =>
      photo({ id: `s${index}`, title: `S${index}`, alt: `Alt ${index}`, textStatus: "approved", selected: true, position: index + 1 }),
    );
    renderAt(fakeApi([...eight, egret]));
    expect((await screen.findByRole("button", { name: "Show Egret on the site" })).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Eight are selected. Remove one to add another.")).toBeTruthy();
    expect(screen.getByText("8 of 8 selected. Aim for about six.")).toBeTruthy();
  });

  it("shows the server's reason when selecting is refused", async () => {
    const setSelected = vi.fn(async () => {
      throw new ApiRequestError(409, "selection_full", "A category can show at most 8 photographs. Deselect one first.");
    });
    renderAt(fakeApi([egret], { setSelected } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Show Egret on the site" }));
    expect((await screen.findByRole("alert")).textContent).toContain("at most 8 photographs");
  });

  it("opens the editor and applies its change", async () => {
    const saved = { ...untitled, title: "Three giraffes", alt: "Three giraffes in the grass", description: "Three giraffes graze.", textStatus: "approved" as const };
    const saveText = vi.fn(async () => saved);
    renderAt(fakeApi([untitled], { saveText } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Edit Untitled photograph 1" }));
    const dialog = within(screen.getByRole("dialog", { name: "Untitled photograph" }));
    await userEvent.type(dialog.getByLabelText("Title"), "Three giraffes");
    await userEvent.type(dialog.getByLabelText("Alt text"), "Three giraffes in the grass");
    await userEvent.type(dialog.getByLabelText("Description"), "Three giraffes graze.");
    await userEvent.click(dialog.getByRole("button", { name: "Approve text" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(saveText).toHaveBeenCalledWith("untitled", {
      title: "Three giraffes",
      alt: "Three giraffes in the grass",
      description: "Three giraffes graze.",
    });
    expect(screen.getByRole("button", { name: "Show Three giraffes on the site" })).toBeTruthy();
    expect(section("Not shown").getByText("Ready")).toBeTruthy();
  });

  it("edits a photograph already shown on the site without removing it", async () => {
    const updatedTiger = { ...tiger, title: "Resting tiger", alt: "A resting tiger", description: "A tiger rests in the shade." };
    const saveText = vi.fn(async () => updatedTiger);
    renderAt(fakeApi([tiger, zebra], { saveText } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Edit Tiger" }));
    const dialog = within(screen.getByRole("dialog", { name: "Tiger" }));
    expect((dialog.getByLabelText("Title") as HTMLInputElement).value).toBe("Tiger");
    expect((dialog.getByLabelText("Alt text") as HTMLTextAreaElement).value).toBe("A tiger resting");
    await userEvent.clear(dialog.getByLabelText("Title"));
    await userEvent.type(dialog.getByLabelText("Title"), "Resting tiger");
    await userEvent.type(dialog.getByLabelText("Description"), "A tiger rests in the shade.");
    await userEvent.click(dialog.getByRole("button", { name: "Save text" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const shown = section("Shown on the site");
    expect(shown.getAllByRole("img").map((img) => img.getAttribute("alt"))).toEqual(["A resting tiger", "A zebra grazing"]);
    expect(shown.getByText("Resting tiger")).toBeTruthy();
  });

  it("returns focus to the Edit button after Close", async () => {
    renderAt(fakeApi([egret]));
    const editButton = await screen.findByRole("button", { name: "Edit Egret" });
    await userEvent.click(editButton);
    await screen.findByRole("dialog", { name: "Egret" });
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(editButton);
  });

  it("returns focus to the Edit button, found by its new name, after approving text", async () => {
    const saved = { ...untitled, title: "Three giraffes", alt: "Three giraffes in the grass", description: "Three giraffes graze.", textStatus: "approved" as const };
    const saveText = vi.fn(async () => saved);
    renderAt(fakeApi([untitled], { saveText } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Edit Untitled photograph 1" }));
    const dialog = within(screen.getByRole("dialog", { name: "Untitled photograph" }));
    await userEvent.type(dialog.getByLabelText("Title"), "Three giraffes");
    await userEvent.type(dialog.getByLabelText("Alt text"), "Three giraffes in the grass");
    await userEvent.type(dialog.getByLabelText("Description"), "Three giraffes graze.");
    await userEvent.click(dialog.getByRole("button", { name: "Approve text" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const renamedButton = await screen.findByRole("button", { name: "Edit Three giraffes" });
    expect(document.activeElement).toBe(renamedButton);
  });

  it("focuses the section heading after deleting (confirmed)", async () => {
    const deletePhoto = vi.fn(async () => undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderAt(fakeApi([untitled], { deletePhoto } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Edit Untitled photograph 1" }));
    await screen.findByRole("dialog", { name: "Untitled photograph" });
    await userEvent.click(screen.getByRole("button", { name: "Delete photograph" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(deletePhoto).toHaveBeenCalledWith("untitled");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Not shown" }));
  });

  it("focuses the section heading after moving to another category", async () => {
    const movePhoto = vi.fn(async () => ({ ...tiger, categoryId: "river" }));
    renderAt(fakeApi([tiger, zebra], { movePhoto } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Edit Tiger" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Tiger" }));
    await userEvent.selectOptions(dialog.getByLabelText("Move to"), "river");
    await userEvent.click(dialog.getByRole("button", { name: "Move" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(movePhoto).toHaveBeenCalledWith("tiger", "river");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Shown on the site" }));
  });

  it("offers a way forward when loading fails because the owner has been signed out", async () => {
    renderAt(
      fakeApi([], {
        listCategories: vi.fn(async () => {
          throw new ApiRequestError(401, "signed_out", "You have been signed out. Reload the page to sign in again.");
        }),
      } as Partial<Api>),
    );
    expect((await screen.findByRole("alert")).textContent).toBe("You have been signed out. Reload the page to sign in again.");
    expect(screen.getByRole("button", { name: "Reload the page" })).toBeTruthy();
  });

  it("reports an unknown category", async () => {
    renderAt(fakeApi([]), "nope");
    expect(await screen.findByText("No such category.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to the library" }).getAttribute("href")).toBe("/");
  });
});

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, type Api } from "../api";
import { LibraryProvider } from "../library";
import type { CategoryOut, PhotoOut } from "../types";
import { CategoryScreen } from "./CategoryScreen";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const zoo = { id: "zoo", slug: "phoenix-zoo", title: "Phoenix Zoo", place: "Arizona", description: "Animals.", hidden: false } as CategoryOut;
const river = { id: "river", slug: "salt-river", title: "Salt River", place: "Arizona", description: "Water.", hidden: false } as CategoryOut;

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

const tiger = photo({ id: "tiger", title: "Tiger", alt: "A tiger resting", description: "A tiger.", textStatus: "approved", selected: true, position: 1 });
const zebra = photo({ id: "zebra", title: "Zebra", alt: "A zebra grazing", description: "A zebra.", textStatus: "approved", selected: true, position: 2 });
const egret = photo({ id: "egret", title: "Egret", alt: "A white egret", description: "An egret.", textStatus: "approved" });
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
      <LibraryProvider api={api}>
        <Routes>
          <Route path="/c/:categoryId" element={<CategoryScreen api={api} categoryId={id} />} />
        </Routes>
      </LibraryProvider>
    </MemoryRouter>,
  );
}

const section = (name: string) => within(screen.getByRole("region", { name }));
const alts = (name: string) => section(name).getAllByRole("img").map((img) => img.getAttribute("alt"));
const tick = (name: string) => screen.getByRole("button", { name: `Show ${name} on the site` });

describe("CategoryScreen", () => {
  it("shows the category, the count, and both groups", async () => {
    renderAt(fakeApi([tiger, zebra, egret, untitled, anotherUntitled]));
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Phoenix Zoo");
    expect(document.title).toBe("Phoenix Zoo — Library — Digital Hitchhiker");
    expect(await screen.findByText("2 shown")).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();

    expect(alts("Shown on the site")).toEqual(["A tiger resting", "A zebra grazing"]);
    const rest = section("Not shown");
    expect(rest.getAllByText("Needs text")).toHaveLength(2);
    expect(rest.getAllByRole("img", { name: "Untitled photograph" })).toHaveLength(2);
  });

  it("gives every photograph the same three controls, named for it, and a reorder handle only when shown", async () => {
    renderAt(fakeApi([tiger, egret, untitled, anotherUntitled]));
    await screen.findByRole("region", { name: "Not shown" });
    const names = (region: string) => section(region).getAllByRole("button").map((button) => button.getAttribute("aria-label"));
    expect(names("Shown on the site")).toEqual(["Show Tiger on the site", "Edit Tiger", "Delete Tiger", "Reorder Tiger"]);
    expect(names("Not shown")).toEqual([
      "Show Egret on the site",
      "Edit Egret",
      "Delete Egret",
      "Show Untitled photograph 1 on the site",
      "Edit Untitled photograph 1",
      "Delete Untitled photograph 1",
      "Show Untitled photograph 2 on the site",
      "Edit Untitled photograph 2",
      "Delete Untitled photograph 2",
    ]);
    expect(tick("Tiger").getAttribute("aria-pressed")).toBe("true");
    expect(tick("Egret").getAttribute("aria-pressed")).toBe("false");
    const handle = screen.getByRole("button", { name: "Reorder Tiger" });
    expect(handle.getAttribute("aria-roledescription")).toBe("sortable");
    expect(handle.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("says so when nothing is shown, and when the category is empty", async () => {
    renderAt(fakeApi([egret]));
    expect(await screen.findByText("Nothing shown yet, so this category is not on the site. Tick a photograph below to show it.")).toBeTruthy();
    expect(screen.getByText("0 shown")).toBeTruthy();
    expect(screen.getByText("Not shown", { selector: ".status" })).toBeTruthy();
    cleanup();
    renderAt(fakeApi([]));
    expect(await screen.findByText("No photographs yet. Add some above.")).toBeTruthy();
  });

  it("shows a photograph, reloads from the server, and keeps focus on its tick", async () => {
    const after = [tiger, zebra, { ...egret, selected: true, position: 3 }];
    const listPhotos = vi.fn().mockResolvedValueOnce([tiger, zebra, egret]).mockResolvedValueOnce(after);
    const setSelected = vi.fn(async () => after[2]!);
    renderAt(fakeApi([], { listPhotos, setSelected } as Partial<Api>));
    await screen.findByRole("region", { name: "Not shown" });
    await userEvent.click(tick("Egret"));
    expect(setSelected).toHaveBeenCalledWith("egret", true);
    await waitFor(() => expect(screen.getByText("3 shown")).toBeTruthy());
    expect(alts("Shown on the site")).toHaveLength(3);
    expect(tick("Egret").getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(tick("Egret")));
    expect(screen.getByText("Egret is now shown on the site.")).toBeTruthy();
  });

  it("takes a photograph off the site with the same tick", async () => {
    const listPhotos = vi.fn().mockResolvedValueOnce([tiger, zebra]).mockResolvedValueOnce([{ ...zebra, position: 1 }, { ...tiger, selected: false, position: 0 }]);
    const setSelected = vi.fn(async () => tiger);
    renderAt(fakeApi([], { listPhotos, setSelected } as Partial<Api>));
    await screen.findByRole("region", { name: "Not shown" });
    await userEvent.click(tick("Tiger"));
    expect(setSelected).toHaveBeenCalledWith("tiger", false);
    await waitFor(() => expect(screen.getByText("1 shown")).toBeTruthy());
    expect(alts("Not shown")).toEqual(["A tiger resting"]);
    expect(screen.getByText("Tiger is no longer shown on the site.")).toBeTruthy();
  });

  it("asks for the text first when a photograph without it is ticked, then shows it", async () => {
    const saved = { ...untitled, title: "Three giraffes", alt: "Three giraffes in the grass", description: "Three giraffes graze.", textStatus: "approved" as const };
    const saveText = vi.fn(async () => saved);
    const setSelected = vi.fn(async () => ({ ...saved, selected: true, position: 1 }));
    const listPhotos = vi.fn().mockResolvedValueOnce([untitled]).mockResolvedValueOnce([{ ...saved, selected: true, position: 1 }]);
    renderAt(fakeApi([], { listPhotos, saveText, setSelected } as Partial<Api>));
    await screen.findByRole("region", { name: "Not shown" });
    await userEvent.click(tick("Untitled photograph 1"));
    expect(setSelected).not.toHaveBeenCalled();
    const dialog = within(screen.getByRole("dialog", { name: "Untitled photograph" }));
    await userEvent.type(dialog.getByLabelText("Title"), "Three giraffes");
    await userEvent.type(dialog.getByLabelText("Alt text"), "Three giraffes in the grass");
    await userEvent.type(dialog.getByLabelText("Description"), "Three giraffes graze.");
    await userEvent.click(dialog.getByRole("button", { name: "Save and show on the site" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(saveText).toHaveBeenCalledWith("untitled", { title: "Three giraffes", alt: "Three giraffes in the grass", description: "Three giraffes graze." });
    await waitFor(() => expect(setSelected).toHaveBeenCalledWith("untitled", true));
    await waitFor(() => expect(alts("Shown on the site")).toEqual(["Three giraffes in the grass"]));
    await waitFor(() => expect(document.activeElement).toBe(tick("Three giraffes")));
  });

  it("does not show a photograph when the editor opened by its tick is closed without saving", async () => {
    const setSelected = vi.fn();
    renderAt(fakeApi([untitled], { setSelected } as Partial<Api>));
    await screen.findByRole("region", { name: "Not shown" });
    await userEvent.click(tick("Untitled photograph 1"));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(setSelected).not.toHaveBeenCalled();
  });

  it("opens the editor from the image as well as from the pencil", async () => {
    renderAt(fakeApi([egret]));
    await userEvent.click(await screen.findByRole("img", { name: "A white egret" }));
    expect(screen.getByRole("dialog", { name: "Egret" })).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Save text" })).toBeTruthy();
  });

  it("moves a shown photograph without dragging, from its editor, by sending the whole order", async () => {
    const orderSelection = vi.fn(async () => [{ ...zebra, position: 1 }, { ...tiger, position: 2 }]);
    renderAt(fakeApi([tiger, zebra], { orderSelection } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Edit Tiger" }));
    const dialog = within(screen.getByRole("dialog", { name: "Tiger" }));
    expect(dialog.getByRole("status").textContent).toBe("Position 1 of 2 on the site");
    expect(dialog.getByRole("button", { name: "Move earlier" }).getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(dialog.getByRole("button", { name: "Move later" }));
    expect(orderSelection).toHaveBeenCalledWith("zoo", ["zebra", "tiger"]);
    await waitFor(() => expect(alts("Shown on the site")).toEqual(["A zebra grazing", "A tiger resting"]));
    await waitFor(() => expect(dialog.getByRole("status").textContent).toBe("Position 2 of 2 on the site"));
    await waitFor(() => expect(dialog.getByRole("button", { name: "Move earlier" }).getAttribute("aria-disabled")).toBeNull());
    expect(dialog.getByRole("button", { name: "Move later" }).getAttribute("aria-disabled")).toBe("true");
    // It has reached the end, so focus moves to the button that still works.
    expect(document.activeElement).toBe(dialog.getByRole("button", { name: "Move earlier" }));
  });

  it("shows a new order at once, before the server has answered", async () => {
    let answer!: (list: PhotoOut[]) => void;
    const orderSelection = vi.fn(() => new Promise<PhotoOut[]>((resolve) => (answer = resolve)));
    renderAt(fakeApi([tiger, zebra, egret], { orderSelection } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Edit Tiger" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Move later" }));
    expect(alts("Shown on the site")).toEqual(["A zebra grazing", "A tiger resting"]);
    expect(alts("Not shown")).toEqual(["A white egret"]);
    answer([{ ...zebra, position: 1 }, { ...tiger, position: 2 }, egret]);
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Move earlier" }).getAttribute("aria-disabled")).toBeNull());
    expect(alts("Shown on the site")).toEqual(["A zebra grazing", "A tiger resting"]);
  });

  it("carries out every tick pressed in quick succession, one after another", async () => {
    const heron = photo({ id: "heron", title: "Heron", alt: "A grey heron", description: "A heron.", textStatus: "approved" });
    const releases: Array<() => void> = [];
    const setSelected = vi.fn(
      (id: string) => new Promise<PhotoOut>((resolve) => releases.push(() => resolve({ ...(id === "egret" ? egret : heron), selected: true }))),
    );
    const listPhotos = vi
      .fn()
      .mockResolvedValueOnce([egret, heron])
      .mockResolvedValueOnce([{ ...egret, selected: true, position: 1 }, heron])
      .mockResolvedValueOnce([{ ...egret, selected: true, position: 1 }, { ...heron, selected: true, position: 2 }]);
    renderAt(fakeApi([], { listPhotos, setSelected } as Partial<Api>));
    await screen.findByRole("region", { name: "Not shown" });
    await userEvent.click(tick("Egret"));
    await userEvent.click(tick("Heron"));
    // The second press waits its turn; it is not thrown away.
    expect(setSelected.mock.calls).toEqual([["egret", true]]);
    releases[0]!();
    await waitFor(() => expect(setSelected.mock.calls).toEqual([["egret", true], ["heron", true]]));
    releases[1]!();
    await waitFor(() => expect(alts("Shown on the site")).toEqual(["A white egret", "A grey heron"]));
  });

  it("shows only the final answer when moves are made in quick succession", async () => {
    const lion = photo({ id: "lion", title: "Lion", alt: "A lion asleep", description: "A lion.", textStatus: "approved", selected: true, position: 3 });
    const answers: Array<(list: PhotoOut[]) => void> = [];
    const orderSelection = vi.fn(() => new Promise<PhotoOut[]>((resolve) => answers.push(resolve)));
    renderAt(fakeApi([tiger, zebra, lion], { orderSelection } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Edit Tiger" }));
    const later = within(screen.getByRole("dialog")).getByRole("button", { name: "Move later" });
    await userEvent.click(later);
    await userEvent.click(later);
    const final = ["A zebra grazing", "A lion asleep", "A tiger resting"];
    expect(alts("Shown on the site")).toEqual(final);
    await waitFor(() => expect(answers).toHaveLength(1));
    expect(orderSelection.mock.calls[0]).toEqual(["zoo", ["zebra", "tiger", "lion"]]);

    // The answer to the first move describes an order that is already out of
    // date; it must not pull the tiles back.
    answers[0]!([zebra, tiger, lion]);
    await waitFor(() => expect(answers).toHaveLength(2));
    expect(orderSelection.mock.calls[1]).toEqual(["zoo", ["zebra", "lion", "tiger"]]);
    expect(alts("Shown on the site")).toEqual(final);
    answers[1]!([zebra, lion, tiger]);
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("status").textContent).toBe("Position 3 of 3 on the site"));
    expect(alts("Shown on the site")).toEqual(final);
  });

  it("opens the editor, where the move buttons are, when a handle is pressed rather than dragged", async () => {
    renderAt(fakeApi([tiger, zebra]));
    await userEvent.click(await screen.findByRole("button", { name: "Reorder Zebra" }));
    expect(within(screen.getByRole("dialog", { name: "Zebra" })).getByRole("button", { name: "Move earlier" })).toBeTruthy();
  });

  it("never shows a photograph whose editor was closed before its save landed, not even when another editor closes later", async () => {
    let finish!: (saved: PhotoOut) => void;
    const saved = { ...untitled, title: "Three giraffes", alt: "Three giraffes in the grass", description: "Three giraffes graze.", textStatus: "approved" as const };
    const saveText = vi.fn(() => new Promise<PhotoOut>((resolve) => (finish = resolve)));
    const setSelected = vi.fn();
    renderAt(fakeApi([egret, untitled], { saveText, setSelected } as Partial<Api>));
    await screen.findByRole("region", { name: "Not shown" });
    await userEvent.click(tick("Untitled photograph 1"));
    const dialog = within(screen.getByRole("dialog"));
    await userEvent.type(dialog.getByLabelText("Title"), "Three giraffes");
    await userEvent.type(dialog.getByLabelText("Alt text"), "Three giraffes in the grass");
    await userEvent.type(dialog.getByLabelText("Description"), "Three giraffes graze.");
    await userEvent.click(dialog.getByRole("button", { name: "Save and show on the site" }));
    // Forced shut (a browser allows it, for instance on a second Escape)
    // while the save is still on its way.
    (screen.getByRole("dialog") as HTMLDialogElement).close();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    finish(saved);
    expect(await screen.findByRole("button", { name: "Edit Three giraffes" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Edit Egret" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(setSelected).not.toHaveBeenCalled();
  });

  it("offers no position controls for a photograph that is not shown", async () => {
    renderAt(fakeApi([tiger, egret]));
    await userEvent.click(await screen.findByRole("button", { name: "Edit Egret" }));
    const dialog = within(screen.getByRole("dialog", { name: "Egret" }));
    expect(dialog.queryByRole("button", { name: "Move earlier" })).toBeNull();
  });

  it("after a reorder shows exactly the list the server returned, including a photograph added meanwhile", async () => {
    const arrived = photo({ id: "arrived", textStatus: "needs_text" });
    const orderSelection = vi.fn(async () => [{ ...zebra, position: 1 }, { ...tiger, position: 2 }, arrived, egret]);
    renderAt(fakeApi([tiger, zebra, egret], { orderSelection } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Edit Tiger" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Move later" }));
    await waitFor(() => expect(alts("Not shown")).toEqual(["Untitled photograph", "A white egret"]));
    expect(alts("Shown on the site")).toEqual(["A zebra grazing", "A tiger resting"]);
  });

  it("puts the old order back, and says why inside the editor, when the server refuses a reorder", async () => {
    const orderSelection = vi.fn(async () => {
      throw new ApiRequestError(409, "stale", "The selection changed. Reload and try again.");
    });
    renderAt(fakeApi([tiger, zebra], { orderSelection } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Edit Tiger" }));
    const dialog = within(screen.getByRole("dialog", { name: "Tiger" }));
    await userEvent.click(dialog.getByRole("button", { name: "Move later" }));
    expect((await dialog.findByRole("alert")).textContent).toContain("The selection changed");
    expect(alts("Shown on the site")).toEqual(["A tiger resting", "A zebra grazing"]);
    expect(dialog.getByRole("status").textContent).toBe("Position 1 of 2 on the site");
  });

  it("lets a ninth photograph be shown, and draws one square for each", async () => {
    const eight = Array.from({ length: 8 }, (_, index) =>
      photo({ id: `s${index}`, title: `S${index}`, alt: `Alt ${index}`, textStatus: "approved", selected: true, position: index + 1 }),
    );
    const ninth = { ...egret, selected: true, position: 9 };
    const listPhotos = vi.fn().mockResolvedValueOnce([...eight, egret]).mockResolvedValueOnce([...eight, ninth]);
    const setSelected = vi.fn(async () => ninth);
    renderAt(fakeApi([], { listPhotos, setSelected } as Partial<Api>));
    await screen.findByRole("region", { name: "Not shown" });
    const squares = () => document.querySelectorAll(".meter span");
    expect(screen.getByText("8 shown")).toBeTruthy();
    expect(squares()).toHaveLength(8);
    expect(screen.queryByText(/Untick one/)).toBeNull();

    expect(tick("Egret").getAttribute("aria-disabled")).toBeNull();
    await userEvent.click(tick("Egret"));
    expect(setSelected).toHaveBeenCalledWith("egret", true);
    await waitFor(() => expect(screen.getByText("9 shown")).toBeTruthy());
    expect(squares()).toHaveLength(9);
  });

  it("shows the server's reason when showing is refused", async () => {
    const setSelected = vi.fn(async () => {
      throw new ApiRequestError(409, "text_not_approved", "Approve this photograph's title and descriptions before selecting it.");
    });
    renderAt(fakeApi([egret], { setSelected } as Partial<Api>));
    await screen.findByRole("region", { name: "Not shown" });
    await userEvent.click(tick("Egret"));
    expect((await screen.findByRole("alert")).textContent).toContain("Approve this photograph's title");
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
    await userEvent.click(dialog.getByRole("button", { name: "Save text" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(saveText).toHaveBeenCalledWith("untitled", {
      title: "Three giraffes",
      alt: "Three giraffes in the grass",
      description: "Three giraffes graze.",
    });
    expect(tick("Three giraffes").getAttribute("aria-pressed")).toBe("false");
    expect(section("Not shown").queryByText("Needs text")).toBeNull();
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
    await userEvent.click(dialog.getByRole("button", { name: "Save text" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(alts("Shown on the site")).toEqual(["A resting tiger", "A zebra grazing"]);
    expect(section("Shown on the site").getByText("Resting tiger")).toBeTruthy();
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

  it("returns focus to the Edit button, found by its new name, after saving text", async () => {
    const saved = { ...untitled, title: "Three giraffes", alt: "Three giraffes in the grass", description: "Three giraffes graze.", textStatus: "approved" as const };
    const saveText = vi.fn(async () => saved);
    renderAt(fakeApi([untitled], { saveText } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Edit Untitled photograph 1" }));
    const dialog = within(screen.getByRole("dialog", { name: "Untitled photograph" }));
    await userEvent.type(dialog.getByLabelText("Title"), "Three giraffes");
    await userEvent.type(dialog.getByLabelText("Alt text"), "Three giraffes in the grass");
    await userEvent.type(dialog.getByLabelText("Description"), "Three giraffes graze.");
    await userEvent.click(dialog.getByRole("button", { name: "Save text" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const renamedButton = await screen.findByRole("button", { name: "Edit Three giraffes" });
    expect(document.activeElement).toBe(renamedButton);
  });

  it("deletes from the tile only after confirmation, then focuses the group's heading", async () => {
    const deletePhoto = vi.fn(async () => undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderAt(fakeApi([tiger, egret], { deletePhoto } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Delete Egret" }));
    expect(confirm).toHaveBeenLastCalledWith("Delete Egret from the library? This cannot be undone.");
    expect(deletePhoto).not.toHaveBeenCalled();
    expect(alts("Not shown")).toEqual(["A white egret"]);

    await userEvent.click(screen.getByRole("button", { name: "Delete Egret" }));
    expect(deletePhoto).toHaveBeenCalledWith("egret");
    await waitFor(() => expect(section("Not shown").queryAllByRole("img")).toEqual([]));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Not shown" }));
    expect(screen.getByText("Egret was deleted.")).toBeTruthy();
  });

  it("focuses the group's heading after deleting from the editor (confirmed)", async () => {
    const deletePhoto = vi.fn(async () => undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderAt(fakeApi([untitled], { deletePhoto } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Edit Untitled photograph 1" }));
    await screen.findByRole("dialog", { name: "Untitled photograph" });
    await userEvent.click(screen.getByRole("button", { name: "Delete photograph" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(deletePhoto).toHaveBeenCalledWith("untitled");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Not shown" }));
    expect(screen.getByText("Untitled photograph 1 was deleted.").getAttribute("role")).toBe("status");
  });

  it("focuses the group's heading after moving to another category", async () => {
    const movePhoto = vi.fn(async () => ({ ...tiger, categoryId: "river" }));
    renderAt(fakeApi([tiger, zebra], { movePhoto } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Edit Tiger" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Tiger" }));
    await userEvent.selectOptions(dialog.getByLabelText("Move to"), "river");
    await userEvent.click(dialog.getByRole("button", { name: "Move" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(movePhoto).toHaveBeenCalledWith("tiger", "river");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Shown on the site" }));
    expect(alts("Shown on the site")).toEqual(["A zebra grazing"]);
    expect(screen.getByText("Tiger was moved to another category.").getAttribute("role")).toBe("status");
  });

  it("hides and shows the category from its own screen", async () => {
    const updateCategory = vi.fn(async (_id: string, patch: { hidden?: boolean }) => ({ ...zoo, hidden: patch.hidden! }));
    renderAt(fakeApi([tiger], { updateCategory } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Hide this category from the site" }));
    expect(updateCategory).toHaveBeenCalledWith("zoo", { hidden: true });
    expect(await screen.findByRole("button", { name: "Show this category on the site" })).toBeTruthy();
    expect(screen.getByText("Hidden")).toBeTruthy();
    expect(screen.getByText("Phoenix Zoo is now hidden from the site.").getAttribute("role")).toBe("status");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Show this category on the site" }));
  });

  it("renames the category from its own screen", async () => {
    const updateCategory = vi.fn(async () => ({ ...zoo, title: "The Zoo" }));
    renderAt(fakeApi([tiger], { updateCategory } as Partial<Api>));
    await userEvent.click(await screen.findByRole("button", { name: "Edit category details" }));
    const dialog = within(screen.getByRole("dialog", { name: "Phoenix Zoo details" }));
    await userEvent.clear(dialog.getByLabelText("Title"));
    await userEvent.type(dialog.getByLabelText("Title"), "The Zoo");
    await userEvent.click(dialog.getByRole("button", { name: "Save details" }));
    expect(updateCategory).toHaveBeenCalledWith("zoo", { title: "The Zoo", place: "Arizona", description: "Animals." });
    expect((await screen.findByRole("heading", { level: 1, name: "The Zoo" })).textContent).toBe("The Zoo");
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

  it("reports an unknown category without asking the server for its photographs", async () => {
    const api = fakeApi([]);
    renderAt(api, "nope");
    expect(await screen.findByText("No such category.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to the library" }).getAttribute("href")).toBe("/");
    expect(api.listPhotos).not.toHaveBeenCalled();
  });
});

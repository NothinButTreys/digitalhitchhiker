import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, type Api } from "../api";
import type { CategoryOut, PhotoOut } from "../types";
import { PhotoEditor } from "./PhotoEditor";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const photo = (overrides: Partial<PhotoOut> = {}): PhotoOut => ({
  id: "p1",
  categoryId: "zoo",
  slug: null,
  title: "Tiger",
  alt: "A tiger resting in dry grass",
  description: "A tiger rests.",
  textStatus: "needs_text",
  selected: false,
  position: 0,
  originalName: "fam-10.JPG",
  width: 3888,
  height: 2592,
  source: "upload",
  createdAt: "2026-09-29T00:00:00.000Z",
  previewUrl: "/api/photos/p1/preview",
  ...overrides,
});

const categories = [
  { id: "zoo", title: "Phoenix Zoo" },
  { id: "river", title: "Salt River" },
] as CategoryOut[];

type Extra = Partial<Pick<Parameters<typeof PhotoEditor>[0], "intent" | "order" | "categories">>;

function setup(current: PhotoOut, api: Partial<Api> = {}, extra: Extra = {}) {
  const onChange = vi.fn();
  const onRemoved = vi.fn();
  const onClose = vi.fn();
  render(
    <PhotoEditor api={api as Api} photo={current} categories={categories} onChange={onChange} onRemoved={onRemoved} onClose={onClose} {...extra} />,
  );
  return { onChange, onRemoved, onClose };
}

describe("PhotoEditor", () => {
  it("shows the photograph and its text in a labelled dialog", () => {
    setup(photo());
    const dialog = screen.getByRole("dialog", { name: "Tiger" });
    expect(dialog.hasAttribute("open")).toBe(true);
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Tiger");
    expect((screen.getByLabelText("Alt text") as HTMLTextAreaElement).value).toBe("A tiger resting in dry grass");
    expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe("A tiger rests.");
    expect(screen.getByRole("img").getAttribute("src")).toBe("/api/photos/p1/preview");
    expect(screen.getByText("fam-10.JPG")).toBeTruthy();
    expect(screen.getByText("A photograph needs a title, alt text, and a description before it can be shown on the site.")).toBeTruthy();
    expect(screen.getByText("Say what is visible, for someone who cannot see the photograph.")).toBeTruthy();
  });

  it("names an untitled photograph", () => {
    setup(photo({ title: "", alt: "", description: "", textStatus: "needs_text" }));
    expect(screen.getByRole("dialog", { name: "Untitled photograph" })).toBeTruthy();
  });

  it("saves edited text", async () => {
    const saved = photo({ title: "Resting tiger", textStatus: "approved", slug: "resting-tiger" });
    const saveText = vi.fn(async () => saved);
    const { onChange, onClose } = setup(photo(), { saveText } as Partial<Api>);
    const title = screen.getByLabelText("Title");
    await userEvent.clear(title);
    await userEvent.type(title, "Resting tiger");
    await userEvent.click(screen.getByRole("button", { name: "Save text" }));
    expect(saveText).toHaveBeenCalledWith("p1", {
      title: "Resting tiger",
      alt: "A tiger resting in dry grass",
      description: "A tiger rests.",
    });
    expect(onChange).toHaveBeenCalledWith(saved, { andShow: false });
    expect(onClose).toHaveBeenCalled();
  });

  it("drops the reminder about text once the text is approved", () => {
    setup(photo({ textStatus: "approved" }));
    expect(screen.getByRole("button", { name: "Save text" })).toBeTruthy();
    expect(screen.queryByText(/needs a title, alt text, and a description/)).toBeNull();
  });

  it("offers to save and show when it was opened in order to show the photograph", async () => {
    const saved = photo({ textStatus: "approved", slug: "tiger" });
    const saveText = vi.fn(async () => saved);
    const { onChange, onClose } = setup(photo(), { saveText } as Partial<Api>, { intent: "show" });
    expect(screen.queryByRole("button", { name: "Save text" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save and show on the site" }));
    expect(onChange).toHaveBeenCalledWith(saved, { andShow: true });
    expect(onClose).toHaveBeenCalled();
  });

  it("stays open while a save is on its way, however closing is asked for", async () => {
    let finish!: (saved: PhotoOut) => void;
    const saveText = vi.fn(() => new Promise<PhotoOut>((resolve) => (finish = resolve)));
    const { onClose } = setup(photo(), { saveText } as Partial<Api>, { intent: "show" });
    await userEvent.click(screen.getByRole("button", { name: "Save and show on the site" }));

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    const escape = new Event("cancel", { cancelable: true });
    screen.getByRole("dialog").dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog").hasAttribute("open")).toBe(true);

    finish(photo({ textStatus: "approved" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("never asks to show a photograph if it was closed before its save landed", async () => {
    let finish!: (saved: PhotoOut) => void;
    const saved = photo({ textStatus: "approved" });
    const saveText = vi.fn(() => new Promise<PhotoOut>((resolve) => (finish = resolve)));
    const { onChange } = setup(photo(), { saveText } as Partial<Api>, { intent: "show" });
    await userEvent.click(screen.getByRole("button", { name: "Save and show on the site" }));
    // A browser can still force a dialog shut, for instance on a second Escape.
    (screen.getByRole("dialog") as HTMLDialogElement).close();
    finish(saved);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(saved, { andShow: false }));
  });

  it("leaves Escape alone when nothing is being saved", () => {
    setup(photo());
    const escape = new Event("cancel", { cancelable: true });
    screen.getByRole("dialog").dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
  });

  it("opens on the title field, but on a touch screen on the heading so the keyboard stays down", () => {
    setup(photo());
    expect(document.activeElement).toBe(screen.getByLabelText("Title"));
    cleanup();

    const matchMedia = vi.fn((query: string) => ({ matches: query === "(hover: none)" }));
    vi.stubGlobal("matchMedia", matchMedia);
    try {
      setup(photo());
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Tiger" }));
      cleanup();
      // Opened in order to type the text: the field is where to be, even there.
      setup(photo(), {}, { intent: "show" });
      expect(document.activeElement).toBe(screen.getByLabelText("Title"));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows a shown photograph's position, with buttons that move it without dragging", async () => {
    const move = vi.fn();
    setup(photo({ textStatus: "approved", selected: true }), {}, { order: { index: 1, count: 3, problem: null, move } });
    expect(screen.getByRole("status").textContent).toBe("Position 2 of 3 on the site");
    await userEvent.click(screen.getByRole("button", { name: "Move earlier" }));
    await userEvent.click(screen.getByRole("button", { name: "Move later" }));
    expect(move.mock.calls).toEqual([[-1], [1]]);
  });

  it("stops at either end of the order, and says why a move failed", async () => {
    const order = { count: 3, problem: null, move: vi.fn() };
    // Unavailable buttons are marked, not disabled, so they can keep the
    // keyboard's focus; pressing one does nothing.
    const unavailable = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-disabled") === "true";
    setup(photo({ selected: true }), {}, { order: { ...order, index: 0 } });
    expect([unavailable("Move earlier"), unavailable("Move later")]).toEqual([true, false]);
    expect(screen.getByRole("button", { name: "Move earlier" }).hasAttribute("disabled")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Move earlier" }));
    expect(order.move).not.toHaveBeenCalled();
    cleanup();
    setup(photo({ selected: true }), {}, { order: { ...order, index: 2 } });
    expect([unavailable("Move earlier"), unavailable("Move later")]).toEqual([false, true]);
    cleanup();
    setup(photo({ selected: true }), {}, { order: { ...order, index: 1, problem: { code: "stale", message: "The selection changed." } } });
    expect([unavailable("Move earlier"), unavailable("Move later")]).toEqual([false, false]);
    expect(screen.getByRole("alert").textContent).toBe("The selection changed.");
  });

  it("offers no position controls for a photograph that is not shown, and no move when there is nowhere to move to", () => {
    setup(photo(), {}, { categories: [categories[0]!] });
    expect(screen.queryByRole("button", { name: "Move earlier" })).toBeNull();
    expect(screen.queryByLabelText("Move to")).toBeNull();
  });

  it("keeps the dialog open with the typed text when saving fails", async () => {
    const saveText = vi.fn(async () => {
      throw new ApiRequestError(400, "invalid", 'alt must describe what is visible, not begin with "photo of"');
    });
    const { onChange, onClose } = setup(photo(), { saveText } as Partial<Api>);
    const alt = screen.getByLabelText("Alt text");
    await userEvent.clear(alt);
    await userEvent.type(alt, "Photo of a tiger");
    await userEvent.click(screen.getByRole("button", { name: "Save text" }));
    expect((await screen.findByRole("alert")).textContent).toContain("alt must describe");
    expect((alt as HTMLTextAreaElement).value).toBe("Photo of a tiger");
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("moves to another category", async () => {
    const movePhoto = vi.fn(async () => photo({ categoryId: "river" }));
    const { onRemoved, onClose } = setup(photo(), { movePhoto } as Partial<Api>);
    const select = screen.getByLabelText("Move to") as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual(["Choose a category", "Salt River"]);
    await userEvent.selectOptions(select, "river");
    await userEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(movePhoto).toHaveBeenCalledWith("p1", "river");
    expect(onRemoved).toHaveBeenCalledWith("p1", "moved");
    expect(onClose).toHaveBeenCalled();
  });

  it("deletes only after confirmation", async () => {
    const deletePhoto = vi.fn(async () => undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { onRemoved } = setup(photo(), { deletePhoto } as Partial<Api>);
    await userEvent.click(await screen.findByRole("button", { name: "Delete photograph" }));
    expect(deletePhoto).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete photograph" }));
    expect(confirm).toHaveBeenLastCalledWith("Delete this photograph from the library? This cannot be undone.");
    expect(deletePhoto).toHaveBeenCalledWith("p1");
    expect(onRemoved).toHaveBeenCalledWith("p1", "deleted");
  });

  it("closes without saving", async () => {
    const saveText = vi.fn();
    const { onClose } = setup(photo(), { saveText } as Partial<Api>);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
    expect(saveText).not.toHaveBeenCalled();
  });
});

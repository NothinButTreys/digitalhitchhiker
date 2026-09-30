import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiRequestError, type Api } from "../api";
import type { CategoryOut, PhotoOut } from "../types";
import { PhotoEditor } from "./PhotoEditor";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

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

function setup(current: PhotoOut, api: Partial<Api> = {}) {
  const onChange = vi.fn();
  const onRemoved = vi.fn();
  const onClose = vi.fn();
  render(
    <PhotoEditor api={api as Api} photo={current} categories={categories} onChange={onChange} onRemoved={onRemoved} onClose={onClose} />,
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

  it("approves edited text", async () => {
    const saved = photo({ title: "Resting tiger", textStatus: "approved", slug: "resting-tiger" });
    const saveText = vi.fn(async () => saved);
    const { onChange, onClose } = setup(photo(), { saveText } as Partial<Api>);
    const title = screen.getByLabelText("Title");
    await userEvent.clear(title);
    await userEvent.type(title, "Resting tiger");
    await userEvent.click(screen.getByRole("button", { name: "Approve text" }));
    expect(saveText).toHaveBeenCalledWith("p1", {
      title: "Resting tiger",
      alt: "A tiger resting in dry grass",
      description: "A tiger rests.",
    });
    expect(onChange).toHaveBeenCalledWith(saved);
    expect(onClose).toHaveBeenCalled();
  });

  it("says Save text once approved", () => {
    setup(photo({ textStatus: "approved" }));
    expect(screen.getByRole("button", { name: "Save text" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve text" })).toBeNull();
  });

  it("keeps the dialog open with the typed text when saving fails", async () => {
    const saveText = vi.fn(async () => {
      throw new ApiRequestError(400, "invalid", 'alt must describe what is visible, not begin with "photo of"');
    });
    const { onChange, onClose } = setup(photo(), { saveText } as Partial<Api>);
    const alt = screen.getByLabelText("Alt text");
    await userEvent.clear(alt);
    await userEvent.type(alt, "Photo of a tiger");
    await userEvent.click(screen.getByRole("button", { name: "Approve text" }));
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
    expect(onRemoved).toHaveBeenCalledWith("p1");
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
    expect(onRemoved).toHaveBeenCalledWith("p1");
  });

  it("closes without saving", async () => {
    const saveText = vi.fn();
    const { onClose } = setup(photo(), { saveText } as Partial<Api>);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
    expect(saveText).not.toHaveBeenCalled();
  });
});

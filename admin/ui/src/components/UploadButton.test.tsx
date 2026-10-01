import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, type Api } from "../api";
import { UnreadableImageError, type Prepared } from "../prepare-upload";
import type { PhotoOut } from "../types";
import { UploadButton } from "./UploadButton";

afterEach(cleanup);

const file = (name: string) => new File([name], name, { type: "image/jpeg" });
const prepared = (f: File): Prepared => ({ file: f, contentType: "image/jpeg", contentHash: "h", width: 10, height: 10, preview: new Blob() });
const photo = (id: string): PhotoOut => ({ id, textStatus: "needs_text", title: "" }) as PhotoOut;

function setup(overrides: { upload?: Api["upload"]; prepare?: (f: File) => Promise<Prepared> } = {}) {
  const upload = overrides.upload ?? (vi.fn(async (_c: string, p: Prepared) => photo(p.file.name)) as unknown as Api["upload"]);
  const prepare = overrides.prepare ?? vi.fn(async (f: File) => prepared(f));
  const onUploaded = vi.fn();
  render(<UploadButton api={{ upload } as unknown as Api} categoryId="zoo" onUploaded={onUploaded} prepare={prepare} />);
  return { upload, prepare, onUploaded, input: screen.getByLabelText("Add photographs") as HTMLInputElement };
}

describe("UploadButton", () => {
  it("offers a labelled input for several images", () => {
    const { input } = setup();
    expect(input.type).toBe("file");
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe("image/jpeg,image/png,image/heic,image/heif");
  });

  it("uploads each file in order and reports each stage", async () => {
    const { input, upload, onUploaded } = setup();
    await userEvent.upload(input, [file("a.jpg"), file("b.jpg")]);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("2 added."));
    expect((upload as any).mock.calls.map((call: any[]) => [call[0], call[1].file.name])).toEqual([["zoo", "a.jpg"], ["zoo", "b.jpg"]]);
    expect(onUploaded.mock.calls.map((call) => [call[0].id, call[0].textStatus])).toEqual([
      ["a.jpg", "needs_text"],
      ["b.jpg", "needs_text"],
    ]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input.disabled).toBe(false);
    expect(input.value).toBe("");
  });

  it("takes photographs dropped onto it, and ignores a drag that carries no files", async () => {
    const { input, upload } = setup();
    const zone = input.closest(".upload")!;

    fireEvent.dragOver(zone, { dataTransfer: { types: ["text/plain"], files: [] } });
    expect(zone.hasAttribute("data-over")).toBe(false);

    fireEvent.dragOver(zone, { dataTransfer: { types: ["Files"], files: [] } });
    expect(zone.hasAttribute("data-over")).toBe(true);

    fireEvent.drop(zone, { dataTransfer: { types: ["Files"], files: [file("a.jpg"), file("b.jpg")] } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("2 added."));
    expect((upload as any).mock.calls.map((call: any[]) => call[1].file.name)).toEqual(["a.jpg", "b.jpg"]);
    expect(zone.hasAttribute("data-over")).toBe(false);
  });

  it("ignores a drop while a batch is already uploading", async () => {
    let release!: (value: PhotoOut) => void;
    const upload = vi.fn(() => new Promise<PhotoOut>((resolve) => (release = resolve))) as unknown as Api["upload"];
    const { input } = setup({ upload });
    await userEvent.upload(input, [file("a.jpg")]);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Uploading 1 of 1: a.jpg"));
    fireEvent.drop(input.closest(".upload")!, { dataTransfer: { types: ["Files"], files: [file("late.jpg")] } });
    release(photo("a.jpg"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("1 added."));
    expect((upload as any).mock.calls.map((call: any[]) => call[1].file.name)).toEqual(["a.jpg"]);
  });

  it("stops a file dropped outside the box from replacing the page, and leaves other drags alone", () => {
    const { input } = setup();
    const dropOn = (target: Element | Window, types: string[]) => {
      const event = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: { types, files: [] } });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(dropOn(document.body, ["Files"])).toBe(true);
    expect(dropOn(document.body, ["text/plain"])).toBe(false);
    cleanup();
    expect(input.isConnected).toBe(false);
    expect(dropOn(document.body, ["Files"])).toBe(false);
  });

  it("gives the keyboard's focus back to the input once a batch it started is done", async () => {
    const { input } = setup();
    // As a browser leaves things when its file chooser closes: the files are
    // chosen and the input has the focus again.
    input.focus();
    fireEvent.change(input, { target: { files: [file("a.jpg")] } });
    await waitFor(() => expect(input.disabled).toBe(true));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("1 added."));
    expect(input.disabled).toBe(false);
    expect(document.activeElement).toBe(input);
  });

  it("shows progress while working and disables the input", async () => {
    let release!: (value: PhotoOut) => void;
    const upload = vi.fn(() => new Promise<PhotoOut>((resolve) => (release = resolve))) as unknown as Api["upload"];
    const { input } = setup({ upload });
    await userEvent.upload(input, [file("a.jpg"), file("b.jpg")]);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Uploading 1 of 2: a.jpg"));
    expect(input.disabled).toBe(true);
    const bar = screen.getByRole("progressbar", { name: "Upload progress" }) as HTMLProgressElement;
    expect([bar.value, bar.max]).toEqual([0, 2]);
    release(photo("a.jpg"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Uploading 2 of 2: b.jpg"));
    expect((screen.getByRole("progressbar") as HTMLProgressElement).value).toBe(1);
  });

  it("carries on after a failure and lists what was not added", async () => {
    const upload = vi.fn(async (_c: string, p: Prepared) => {
      if (p.file.name === "dup.jpg") throw new ApiRequestError(409, "duplicate", "This photograph is already in the library.", { photoId: "p9", title: "Tiger" });
      if (p.file.name === "dup2.jpg") throw new ApiRequestError(409, "duplicate", "This photograph is already in the library.", { photoId: "p8", title: "" });
      if (p.file.name === "net.jpg") throw new ApiRequestError(0, "network", "Could not reach the library. Check your connection.");
      return photo(p.file.name);
    }) as unknown as Api["upload"];
    const prepare = vi.fn(async (f: File) => {
      if (f.name === "bad.heic") throw new UnreadableImageError("bad.heic could not be read by this browser. Export it as a JPEG and try again.");
      return prepared(f);
    });
    const { input, onUploaded } = setup({ upload, prepare });
    await userEvent.upload(input, [file("ok.jpg"), file("dup.jpg"), file("dup2.jpg"), file("bad.heic"), file("net.jpg"), file("ok2.jpg")], { applyAccept: false });
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("2 added, 4 not added."));
    const failures = within(screen.getByRole("alert")).getAllByRole("listitem").map((item) => item.textContent);
    expect(failures).toEqual([
      "dup.jpg: already in the library as “Tiger”",
      "dup2.jpg: already in the library",
      "bad.heic could not be read by this browser. Export it as a JPEG and try again.",
      "net.jpg: Could not reach the library. Check your connection.",
    ]);
    expect(onUploaded.mock.calls.map((call) => call[0].id)).toEqual(["ok.jpg", "ok2.jpg"]);
  });

  it("lists two identical failures as two lines, without a React key warning", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const upload = vi.fn(async () => {
        throw new ApiRequestError(0, "network", "Could not reach the library. Check your connection.");
      }) as unknown as Api["upload"];
      const { input } = setup({ upload });
      await userEvent.upload(input, [file("same.jpg"), file("same.jpg")]);
      await waitFor(() => expect(screen.getByRole("status").textContent).toBe("0 added, 2 not added."));
      const failures = within(screen.getByRole("alert")).getAllByRole("listitem").map((item) => item.textContent);
      expect(failures).toEqual([
        "same.jpg: Could not reach the library. Check your connection.",
        "same.jpg: Could not reach the library. Check your connection.",
      ]);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("stops the batch at once when signed out, and shows the reload alert", async () => {
    const upload = vi.fn(async (_c: string, p: Prepared) => {
      if (p.file.name === "b.jpg") {
        throw new ApiRequestError(401, "signed_out", "You have been signed out. Reload the page to sign in again.");
      }
      return photo(p.file.name);
    }) as unknown as Api["upload"];
    const { input, upload: usedUpload, onUploaded } = setup({ upload });
    await userEvent.upload(input, [file("a.jpg"), file("b.jpg"), file("c.jpg")]);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("1 added."));
    expect((usedUpload as any).mock.calls.map((call: any[]) => call[1].file.name)).toEqual(["a.jpg", "b.jpg"]);
    expect(onUploaded.mock.calls.map((call) => call[0].id)).toEqual(["a.jpg"]);
    expect((await screen.findByRole("alert")).textContent).toBe("You have been signed out. Reload the page to sign in again.");
    expect(screen.getByRole("button", { name: "Reload the page" })).toBeTruthy();
  });
});

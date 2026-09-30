import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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

  it("shows progress while working and disables the input", async () => {
    let release!: (value: PhotoOut) => void;
    const upload = vi.fn(() => new Promise<PhotoOut>((resolve) => (release = resolve))) as unknown as Api["upload"];
    const { input } = setup({ upload });
    await userEvent.upload(input, [file("a.jpg"), file("b.jpg")]);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Uploading 1 of 2: a.jpg"));
    expect(input.disabled).toBe(true);
    release(photo("a.jpg"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Uploading 2 of 2: b.jpg"));
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

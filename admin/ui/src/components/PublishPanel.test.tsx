import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, type Api } from "../api";
import type { PublishOut, PublishState } from "../types";
import { PublishPanel } from "./PublishPanel";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const publish = (overrides: Partial<PublishOut> = {}): PublishOut => ({
  id: "p1",
  target: "preview",
  status: "queued",
  message: "",
  url: "",
  startedAt: "2026-09-30T12:00:00.000Z",
  updatedAt: "2026-09-30T12:00:00.000Z",
  finishedAt: null,
  ...overrides,
});

const state = (overrides: Partial<PublishState> = {}): PublishState => ({
  latest: null,
  published: null,
  unpublishedChanges: true,
  problems: [],
  summary: { categories: 5, photographs: 47 },
  ...overrides,
});

function setup(states: PublishState[], api: Partial<Api> = {}) {
  const publishState = vi.fn();
  for (const each of states.slice(0, -1)) publishState.mockResolvedValueOnce(each);
  publishState.mockResolvedValue(states.at(-1));
  const fake = { publishState, startPublish: vi.fn(async () => publish()), ...api } as unknown as Api;
  render(<PublishPanel api={fake} formatTime={(iso) => `at ${iso.slice(11, 16)}`} pollMs={1000} />);
  return fake;
}

const open = async () => {
  await userEvent.click(await screen.findByRole("button", { name: /^Publish/ }));
  return within(screen.getByRole("dialog", { name: "Publish" }));
};

describe("PublishPanel", () => {
  it("says on the button when there are changes waiting to be published", async () => {
    setup([state()]);
    expect(await screen.findByRole("button", { name: "Publish, there are unpublished changes" })).toBeTruthy();
    cleanup();
    setup([state({ unpublishedChanges: false, published: { finishedAt: "2026-09-30T09:41:00.000Z" } })]);
    expect(await screen.findByRole("button", { name: "Publish, the site is up to date" })).toBeTruthy();
  });

  it("says what would be published and that the site has never been published from the library", async () => {
    setup([state()]);
    const dialog = await open();
    expect(dialog.getByText("5 categories and 47 photographs are ready to go on the site.")).toBeTruthy();
    expect(dialog.getByText("The site has not been published from the library yet.")).toBeTruthy();
    expect(dialog.getByRole("button", { name: "Preview first" })).toBeTruthy();
    expect(dialog.getByRole("button", { name: "Publish to the site" })).toBeTruthy();
  });

  it("counts one of each in the singular", async () => {
    setup([state({ summary: { categories: 1, photographs: 1 } })]);
    expect((await open()).getByText("1 category and 1 photograph are ready to go on the site.")).toBeTruthy();
  });

  it("says when the site was last published and whether anything has changed since", async () => {
    setup([state({ unpublishedChanges: false, published: { finishedAt: "2026-09-30T09:41:00.000Z" } })]);
    const dialog = await open();
    expect(dialog.getByText("Last published at 09:41. Nothing has changed since.")).toBeTruthy();
    cleanup();
    setup([state({ published: { finishedAt: "2026-09-30T09:41:00.000Z" } })]);
    expect((await open()).getByText("Last published at 09:41. There are changes since then.")).toBeTruthy();
  });

  it("gives the reason and offers nothing when nothing can be published", async () => {
    const api = setup([state({ problems: ["Nothing is shown in any category, so there is nothing to publish."], summary: { categories: 0, photographs: 0 } })]);
    const dialog = await open();
    expect(dialog.getByRole("alert").textContent).toBe("Nothing is shown in any category, so there is nothing to publish.");
    const button = dialog.getByRole("button", { name: "Publish to the site" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(button);
    expect(api.startPublish).not.toHaveBeenCalled();
  });

  it("starts a preview, then follows its progress to the link", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const running = publish({ status: "running", message: "Preparing photographs (3 of 47)" });
    const done = publish({ status: "succeeded", message: "A preview of 47 photographs in 5 categories is ready.", url: "https://preview.example/x", finishedAt: "2026-09-30T12:05:00.000Z" });
    // Asked for on mount, again when the dialog opens, again after starting,
    // and then once a second while the publish is under way.
    const api = setup([state(), state(), state({ latest: publish() }), state({ latest: running }), state({ latest: done })]);

    await user.click(await screen.findByRole("button", { name: /^Publish/ }));
    const dialog = within(screen.getByRole("dialog", { name: "Publish" }));
    await user.click(dialog.getByRole("button", { name: "Preview first" }));
    expect(api.startPublish).toHaveBeenCalledWith("preview");

    expect((await dialog.findByRole("status")).textContent).toContain("Publishing a preview");
    expect(dialog.queryByRole("button", { name: "Preview first" })).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(1000));
    await waitFor(() => expect(dialog.getByRole("status").textContent).toContain("Preparing photographs (3 of 47)"));

    await act(() => vi.advanceTimersByTimeAsync(1000));
    const link = await dialog.findByRole("link", { name: "Open the preview" });
    expect(link.getAttribute("href")).toBe("https://preview.example/x");
    expect(link.getAttribute("rel")).toBe("noreferrer");
    expect(dialog.getByRole("button", { name: "Publish to the site" })).toBeTruthy();

    // Finished: it stops asking.
    const asked = (api.publishState as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect((api.publishState as ReturnType<typeof vi.fn>).mock.calls.length).toBe(asked);
  });

  it("links to the site after a production publish", async () => {
    setup([state({ unpublishedChanges: false, published: { finishedAt: "2026-09-30T12:05:00.000Z" }, latest: publish({ target: "production", status: "succeeded", url: "https://digitalhitchhiker.photography", finishedAt: "2026-09-30T12:05:00.000Z" }) })]);
    const dialog = await open();
    expect(dialog.getByRole("link", { name: "Open the site" }).getAttribute("href")).toBe("https://digitalhitchhiker.photography");
  });

  it("shows why the last publish failed and lets the owner try again", async () => {
    setup([state({ latest: publish({ status: "failed", message: "Checking the built site failed. 1 test failed", finishedAt: "2026-09-30T12:05:00.000Z" }) })]);
    const dialog = await open();
    expect(dialog.getByRole("alert").textContent).toBe("The last publish failed. Checking the built site failed. 1 test failed");
    expect(dialog.getByRole("button", { name: "Preview first" })).toBeTruthy();
  });

  it("shows the server's reason when a publish cannot be started", async () => {
    const startPublish = vi.fn(async () => {
      throw new ApiRequestError(502, "dispatch_failed", "Publishing is not set up yet: the token that starts it is missing.");
    });
    setup([state()], { startPublish } as unknown as Partial<Api>);
    const dialog = await open();
    await userEvent.click(dialog.getByRole("button", { name: "Publish to the site" }));
    expect((await dialog.findByRole("alert")).textContent).toContain("Publishing is not set up yet");
  });

  it("asks again for the state each time it is opened, and returns focus to its button on Close", async () => {
    const api = setup([state()]);
    const button = await screen.findByRole("button", { name: /^Publish/ });
    const before = (api.publishState as ReturnType<typeof vi.fn>).mock.calls.length;
    await userEvent.click(button);
    await waitFor(() => expect((api.publishState as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before + 1));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(button);
  });
  it("sends one request when Publish is pressed twice before the start has answered", async () => {
    let finish: (out: PublishOut) => void = () => {};
    const startPublish = vi.fn(() => new Promise<PublishOut>((resolve) => (finish = resolve)));
    setup([state(), state(), state({ latest: publish() })], { startPublish } as unknown as Partial<Api>);
    const dialog = await open();
    const publishButton = dialog.getByRole("button", { name: "Publish to the site" });
    const previewButton = dialog.getByRole("button", { name: "Preview first" });
    await userEvent.click(publishButton);
    await userEvent.click(publishButton);
    await userEvent.click(previewButton);
    expect(startPublish).toHaveBeenCalledTimes(1);
    expect(dialog.getByRole("status").textContent).toBe("Starting…");
    expect(publishButton.getAttribute("aria-disabled")).toBe("true");
    expect(previewButton.getAttribute("aria-disabled")).toBe("true");
    await act(async () => finish(publish()));
    expect((await dialog.findByRole("status")).textContent).toContain("Publishing a preview");
    expect(dialog.queryByText("Starting…")).toBeNull();
  });

  it("clears a failed refresh when a later one succeeds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const running = state({ latest: publish({ status: "running" }) });
    const publishState = vi.fn();
    publishState.mockResolvedValueOnce(running).mockResolvedValueOnce(running).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    publishState.mockResolvedValue(running);
    render(<PublishPanel api={{ publishState, startPublish: vi.fn() } as unknown as Api} pollMs={1000} />);
    await user.click(await screen.findByRole("button", { name: /^Publish/ }));
    const dialog = within(screen.getByRole("dialog", { name: "Publish" }));
    await dialog.findByText(/Publishing/);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    await dialog.findByRole("alert");
    await act(() => vi.advanceTimersByTimeAsync(1000));
    await waitFor(() => expect(dialog.queryByRole("alert")).toBeNull());
  });

  it("keeps showing why the last publish failed when a refresh fails", async () => {
    const failed = state({ latest: publish({ status: "failed", message: "Checking the built site failed.", finishedAt: "2026-09-30T12:05:00.000Z" }) });
    const publishState = vi.fn();
    publishState.mockResolvedValueOnce(failed).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    publishState.mockResolvedValue(failed);
    render(<PublishPanel api={{ publishState, startPublish: vi.fn() } as unknown as Api} pollMs={1000} />);
    await userEvent.click(await screen.findByRole("button", { name: /^Publish/ }));
    const dialog = within(screen.getByRole("dialog", { name: "Publish" }));
    await waitFor(() => expect(dialog.getAllByRole("alert").map((a) => a.textContent)).toContain("The last publish failed. Checking the built site failed."));
  });

  describe("announcing a publish that finishes", () => {
    const announcement = () => document.querySelector<HTMLElement>('p.visually-hidden[role="status"]');

    async function finishWith(done: PublishOut) {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      setup([state({ latest: publish({ target: done.target, status: "running" }) }), state({ latest: done })]);
      await screen.findByRole("button", { name: /^Publish/ });
      expect(announcement()?.textContent).toBe("");
      await act(() => vi.advanceTimersByTimeAsync(1000));
      await waitFor(() => expect(announcement()?.textContent).not.toBe(""));
      return announcement()?.textContent;
    }

    it("for a preview that is ready", async () => {
      expect(await finishWith(publish({ status: "succeeded", url: "https://preview.example/x", finishedAt: "2026-09-30T12:05:00.000Z" }))).toBe("The preview is ready.");
    });

    it("for a publish to the site", async () => {
      expect(await finishWith(publish({ target: "production", status: "succeeded", url: "https://site.example", finishedAt: "2026-09-30T12:05:00.000Z" }))).toBe("Published to the site.");
    });

    it("for a publish that failed", async () => {
      expect(await finishWith(publish({ status: "failed", message: "Checking the built site failed.", finishedAt: "2026-09-30T12:05:00.000Z" }))).toBe("The publish failed. Checking the built site failed.");
    });
  });
});

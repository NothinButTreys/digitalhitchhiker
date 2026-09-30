import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "./api";
import { useAction } from "./use-action";

describe("useAction", () => {
  it("starts idle", () => {
    const { result } = renderHook(() => useAction());
    expect(result.current.busy).toBe(false);
    expect(result.current.problem).toBeNull();
  });

  it("runs a successful action and stays free of any problem", async () => {
    const { result } = renderHook(() => useAction());
    const action = vi.fn(async () => undefined);
    await act(async () => {
      await result.current.run(action);
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(false);
    expect(result.current.problem).toBeNull();
  });

  it("is busy only while the action is pending", async () => {
    const { result } = renderHook(() => useAction());
    let resolveAction!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolveAction = resolve;
    });

    let runPromise!: Promise<void>;
    act(() => {
      runPromise = result.current.run(() => pending);
    });
    expect(result.current.busy).toBe(true);

    await act(async () => {
      resolveAction();
      await runPromise;
    });
    expect(result.current.busy).toBe(false);
  });

  it("records an ApiRequestError's code and message", async () => {
    const { result } = renderHook(() => useAction());
    await act(async () => {
      await result.current.run(async () => {
        throw new ApiRequestError(409, "duplicate", "Already in the library.");
      });
    });
    expect(result.current.problem).toEqual({ code: "duplicate", message: "Already in the library." });
    expect(result.current.busy).toBe(false);
  });

  it("records a plain Error as unexpected, keeping its message", async () => {
    const { result } = renderHook(() => useAction());
    await act(async () => {
      await result.current.run(async () => {
        throw new Error("boom");
      });
    });
    expect(result.current.problem).toEqual({ code: "unexpected", message: "boom" });
  });

  it("records a thrown non-error value with a generic message", async () => {
    const { result } = renderHook(() => useAction());
    await act(async () => {
      await result.current.run(async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "nope";
      });
    });
    expect(result.current.problem).toEqual({ code: "unexpected", message: "Something went wrong." });
  });

  it("runs changes one at a time, in the order asked, and is busy until the last has settled", async () => {
    const { result } = renderHook(() => useAction());
    const events: string[] = [];
    let finishFirst!: () => void;
    const first = () =>
      new Promise<void>((resolve) => {
        events.push("first started");
        finishFirst = () => {
          events.push("first finished");
          resolve();
        };
      });
    const second = async () => {
      events.push("second started");
    };

    let done!: Promise<void>;
    act(() => {
      void result.current.run(first);
      done = result.current.run(second);
    });
    await act(async () => {
      await Promise.resolve();
    });
    // The second press is neither dropped nor started early.
    expect(events).toEqual(["first started"]);
    expect(result.current.busy).toBe(true);

    await act(async () => {
      finishFirst();
      await done;
    });
    expect(events).toEqual(["first started", "first finished", "second started"]);
    expect(result.current.busy).toBe(false);
  });

  it("carries on with the next change after one fails, and keeps the failure on show", async () => {
    const { result } = renderHook(() => useAction());
    const second = vi.fn(async () => undefined);
    await act(async () => {
      void result.current.run(async () => {
        throw new Error("first failed");
      });
      await result.current.run(second);
    });
    expect(second).toHaveBeenCalledTimes(1);
    expect(result.current.problem).toEqual({ code: "unexpected", message: "first failed" });
    expect(result.current.busy).toBe(false);
  });

  it("clears a problem before running again", async () => {
    const { result } = renderHook(() => useAction());
    await act(async () => {
      await result.current.run(async () => {
        throw new Error("boom again");
      });
    });
    expect(result.current.problem).not.toBeNull();
    let secondRun!: Promise<void>;
    act(() => {
      secondRun = result.current.run(async () => undefined);
    });
    expect(result.current.problem).toBeNull();
    await act(async () => {
      await secondRun;
    });
  });
});

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

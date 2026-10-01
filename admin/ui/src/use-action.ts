import { useCallback, useRef, useState } from "react";
import { ApiRequestError } from "./api";

export type Failure = { code: string; message: string };

export function describeFailure(error: unknown): Failure {
  if (error instanceof ApiRequestError) return { code: error.code, message: error.message };
  return { code: "unexpected", message: error instanceof Error ? error.message : "Something went wrong." };
}

/**
 * Runs the screen's changes one at a time, in the order they were asked for.
 *
 * A second press while the first is still being saved is not thrown away and
 * does not race the first: it waits its turn. So ticking three photographs
 * in quick succession ticks all three, and nothing on the screen has to be
 * disabled (and lose the keyboard's focus) while a change is on its way.
 *
 * `busy` is true from the first press until the last change has settled.
 * `problem` is the most recent failure; asking for anything new clears it.
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Failure | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const waiting = useRef(0);

  const run = useCallback((action: () => Promise<void>): Promise<void> => {
    waiting.current += 1;
    setProblem(null);
    setBusy(true);
    const turn = queue.current.then(async () => {
      try {
        await action();
      } catch (error) {
        setProblem(describeFailure(error));
      } finally {
        waiting.current -= 1;
        if (waiting.current === 0) setBusy(false);
      }
    });
    queue.current = turn;
    return turn;
  }, []);

  return { busy, problem, run };
}

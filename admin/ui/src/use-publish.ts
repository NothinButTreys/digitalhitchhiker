import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "./api";
import type { PublishState, PublishTarget } from "./types";
import { describeFailure, type Failure } from "./use-action";

/**
 * Where publishing stands, kept up to date: asked for once at the start,
 * again whenever `refresh` is called, and every `pollMs` for as long as a
 * publish is under way.
 */
export function usePublish(api: Api, pollMs = 4000) {
  const [state, setState] = useState<PublishState | null>(null);
  // Two problems, kept apart: a failed look at the state clears itself when
  // a later look succeeds; a refused start stays until the next press.
  const [loadProblem, setLoadProblem] = useState<Failure | null>(null);
  const [startProblem, setStartProblem] = useState<Failure | null>(null);
  const [starting, setStarting] = useState(false);
  const startingNow = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setState(await api.publishState());
      setLoadProblem(null);
    } catch (error) {
      setLoadProblem(describeFailure(error));
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const status = state?.latest?.status;
  const active = status === "queued" || status === "running";

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void refresh(), pollMs);
    return () => window.clearInterval(timer);
  }, [active, refresh, pollMs]);

  const start = useCallback(
    async (target: PublishTarget) => {
      // The server refuses a second publish while one is unfinished, so a
      // second press before this one has been answered sends nothing.
      if (startingNow.current) return;
      startingNow.current = true;
      setStarting(true);
      setStartProblem(null);
      try {
        await api.startPublish(target);
      } catch (error) {
        setStartProblem(describeFailure(error));
      }
      try {
        await refresh();
      } finally {
        startingNow.current = false;
        setStarting(false);
      }
    },
    [api, refresh],
  );

  return { state, problem: startProblem ?? loadProblem, startProblem, active, starting, refresh, start };
}

import { useCallback, useEffect, useState } from "react";
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
  const [problem, setProblem] = useState<Failure | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await api.publishState());
    } catch (error) {
      setProblem(describeFailure(error));
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
      setProblem(null);
      try {
        await api.startPublish(target);
      } catch (error) {
        setProblem(describeFailure(error));
      }
      await refresh();
    },
    [api, refresh],
  );

  return { state, problem, active, refresh, start };
}

import { useCallback, useState } from "react";
import { ApiRequestError } from "./api";

export type Failure = { code: string; message: string };

function describeFailure(error: unknown): Failure {
  if (error instanceof ApiRequestError) return { code: error.code, message: error.message };
  return { code: "unexpected", message: error instanceof Error ? error.message : "Something went wrong." };
}

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Failure | null>(null);

  const run = useCallback(async (action: () => Promise<void>) => {
    setProblem(null);
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setProblem(describeFailure(error));
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, problem, run };
}

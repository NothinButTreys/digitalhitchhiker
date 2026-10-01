import { createContext, useCallback, useContext, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { Api } from "./api";
import type { CategoryOut } from "./types";
import { describeFailure, type Failure } from "./use-action";

type Library = {
  /** Null until the first load finishes. */
  categories: CategoryOut[] | null;
  /** Why the last load failed, if it did. */
  problem: Failure | null;
  /** Fetches the categories again. Never rejects; a failure lands in `problem`. */
  reload: () => Promise<void>;
  setCategories: Dispatch<SetStateAction<CategoryOut[] | null>>;
};

const LibraryContext = createContext<Library | null>(null);

/**
 * Holds the list of categories once for the whole admin, so the navigation
 * and every screen agree, and so moving between screens shows what is
 * already known at once instead of a blank "Loading…".
 */
export function LibraryProvider({ api, children }: { api: Api; children: ReactNode }) {
  const [categories, setList] = useState<CategoryOut[] | null>(null);
  const [problem, setProblem] = useState<Failure | null>(null);

  // A load that was already on its way when the list was changed here (a
  // category created, reordered, hidden, deleted) describes the library as
  // it was before that change. Every change and every new load takes the
  // next number, and an answer is only used if no later number has been
  // taken since it was asked for.
  const generation = useRef(0);

  const setCategories = useCallback<Dispatch<SetStateAction<CategoryOut[] | null>>>((next) => {
    generation.current += 1;
    setList(next);
  }, []);

  const reload = useCallback(async () => {
    generation.current += 1;
    const mine = generation.current;
    try {
      const list = await api.listCategories();
      if (mine !== generation.current) return;
      setList(list);
      setProblem(null);
    } catch (error) {
      if (mine === generation.current) setProblem(describeFailure(error));
    }
  }, [api]);

  const value = useMemo(() => ({ categories, problem, reload, setCategories }), [categories, problem, reload, setCategories]);
  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): Library {
  const library = useContext(LibraryContext);
  if (!library) throw new Error("useLibrary needs a LibraryProvider above it");
  return library;
}

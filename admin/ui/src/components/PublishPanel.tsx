import { useRef, useState } from "react";
import type { Api } from "../api";
import type { PublishOut, PublishState } from "../types";
import { usePublish } from "../use-publish";
import { DialogClose } from "./DialogClose";
import { Problem } from "./Problem";

type Props = {
  api: Api;
  /** How a time is written for the owner; replaced in tests so they do not depend on a locale. */
  formatTime?: (iso: string) => string;
  pollMs?: number;
};

const defaultFormat = (iso: string) =>
  `on ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))}`;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Outcome({ latest }: { latest: PublishOut | null }) {
  if (!latest) return null;
  if (latest.status === "failed") {
    return (
      <p role="alert" className="problem">
        The last publish failed. {latest.message}
      </p>
    );
  }
  if (latest.status !== "succeeded" || !latest.url) return null;
  return (
    <p>
      {latest.target === "preview" ? "The preview is ready. " : "Published. "}
      <a href={latest.url} target="_blank" rel="noreferrer">
        {latest.target === "preview" ? "Open the preview" : "Open the site"}
      </a>
    </p>
  );
}

function Standing({ state, formatTime }: { state: PublishState; formatTime: (iso: string) => string }) {
  if (!state.published) return <p className="muted">The site has not been published from the library yet.</p>;
  return (
    <p className="muted">
      Last published {formatTime(state.published.finishedAt)}.{" "}
      {state.unpublishedChanges ? "There are changes since then." : "Nothing has changed since."}
    </p>
  );
}

/**
 * The Publish button in the header and the dialog it opens. Nothing in the
 * admin reaches the site until this is pressed; the dialog says what would
 * go out, offers a preview first, and follows a publish to its outcome.
 */
export function PublishPanel({ api, formatTime = defaultFormat, pollMs }: Props) {
  const { state, problem, active, refresh, start } = usePublish(api, pollMs);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  const show = () => {
    setOpen(true);
    void refresh();
    // The dialog is in the page from the first render, so it can be opened
    // in the same press and the browser remembers the button to return to.
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLElement>("h2")?.focus();
  };

  const blocked = !state || state.problems.length > 0;
  const press = (target: "preview" | "production") => () => {
    if (!blocked) void start(target);
  };

  const label = !state
    ? "Publish"
    : state.unpublishedChanges
      ? "Publish, there are unpublished changes"
      : "Publish, the site is up to date";

  return (
    <>
      <button type="button" className="publish-button" aria-haspopup="dialog" aria-label={label} onClick={show}>
        Publish
        {state?.unpublishedChanges && <span className="publish-dot" aria-hidden="true" />}
      </button>

      <dialog ref={dialog} className="dialog" aria-labelledby="publish-heading" onClose={() => setOpen(false)}>
        <DialogClose onClose={() => dialog.current?.close()} />
        <h2 id="publish-heading" tabIndex={-1}>
          Publish
        </h2>

        {open && (
          <>
            <Problem error={problem} />
            {!state ? (
              !problem && <p>Loading…</p>
            ) : active ? (
              <>
                <p role="status">
                  Publishing {state.latest?.target === "preview" ? "a preview" : "to the site"}…{" "}
                  {state.latest?.message}
                </p>
                <p className="muted">
                  This takes a few minutes, and longer when there are new photographs. You can close this and carry on.
                </p>
              </>
            ) : (
              <>
                {state.problems.length === 0 ? (
                  <p>
                    {count(state.summary.categories, "category", "categories")} and{" "}
                    {count(state.summary.photographs, "photograph", "photographs")} are ready to go on the site.
                  </p>
                ) : (
                  state.problems.map((reason) => (
                    <p key={reason} role="alert" className="problem">
                      {reason}
                    </p>
                  ))
                )}
                <Standing state={state} formatTime={formatTime} />
                {/* A start that was just refused is already explained above. */}
                {!problem && <Outcome latest={state.latest} />}
                <div className="form-actions">
                  <button type="button" aria-disabled={blocked || undefined} onClick={press("preview")}>
                    Preview first
                  </button>
                  <button type="button" className="primary" aria-disabled={blocked || undefined} onClick={press("production")}>
                    Publish to the site
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </dialog>
    </>
  );
}

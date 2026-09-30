import { useEffect, useRef } from "react";

export type ProblemInfo = { code: string; message: string } | null;

type Props = {
  error: ProblemInfo;
  reload?: () => void;
};

const RELOADABLE = new Set(["signed_out", "network"]);

export function Problem({ error, reload = () => window.location.reload() }: Props) {
  const alert = useRef<HTMLParagraphElement>(null);

  // A problem can appear well away from the button that caused it, above a
  // long grid or at the top of a scrolled dialog. It is brought into view so
  // that pressing something never looks as if it did nothing.
  useEffect(() => {
    if (error) alert.current?.scrollIntoView?.({ block: "nearest" });
  }, [error]);

  if (!error) return null;

  const message = (
    <p ref={alert} role="alert" className="problem">
      {error.message}
    </p>
  );

  if (!RELOADABLE.has(error.code)) return message;

  return (
    <div className="problem-block">
      {message}
      <button type="button" onClick={reload}>
        Reload the page
      </button>
    </div>
  );
}

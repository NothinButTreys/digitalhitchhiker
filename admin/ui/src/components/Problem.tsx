export type ProblemInfo = { code: string; message: string } | null;

type Props = {
  error: ProblemInfo;
  reload?: () => void;
};

const RELOADABLE = new Set(["signed_out", "network"]);

export function Problem({ error, reload = () => window.location.reload() }: Props) {
  if (!error) return null;

  const alert = (
    <p role="alert" className="problem">
      {error.message}
    </p>
  );

  if (!RELOADABLE.has(error.code)) return alert;

  return (
    <div className="problem-block">
      {alert}
      <button type="button" onClick={reload}>
        Reload the page
      </button>
    </div>
  );
}

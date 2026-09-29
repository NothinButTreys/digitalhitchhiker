import { formatCounter } from "../lib/strip-math";

type Props = {
  title: string;
  place: string;
  index: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
};

export function StripFooter({ title, place, index, total, onPrevious, onNext }: Props) {
  return (
    <footer className="strip-footer">
      <div className="strip-title">
        <h1>{title}</h1>
        <p className="label">{place}</p>
      </div>
      <div className="strip-controls">
        <div className="progress" aria-hidden="true">
          <div className="progress-bar" style={{ width: `${((index + 1) / total) * 100}%` }} />
        </div>
        <p className="label counter" data-testid="counter" aria-live="polite">
          <span aria-hidden="true">{formatCounter(index, total)}</span>
          <span className="visually-hidden">
            Photograph {index + 1} of {total}
          </span>
        </p>
        <button type="button" className="arrow" aria-label="Previous photograph" onClick={onPrevious}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <button type="button" className="arrow" aria-label="Next photograph" onClick={onNext}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </footer>
  );
}

import { useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import type { PhotoSet } from "../data/catalog";
import { SITE } from "../data/site";
import { COLOPHON_PATH, setPath } from "../lib/routes";
import { Mark } from "./Mark";

type Props = { sets: PhotoSet[]; currentSlug: string | null };

export function SiteHeader({ sets, currentSlug }: Props) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!open || event.key !== "Escape") return;
    setOpen(false);
    toggle.current?.focus();
  };

  return (
    <header className="site-header" onKeyDown={onKeyDown}>
      <Link to="/" className="wordmark label">
        <Mark />
        {SITE.name}
      </Link>
      <button
        ref={toggle}
        type="button"
        className="menu-toggle"
        aria-label="Photo sets"
        aria-expanded={open}
        aria-controls="site-nav"
        onClick={() => setOpen((value) => !value)}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M4 8h16M4 16h16" />
        </svg>
      </button>
      <nav id="site-nav" className="site-nav" aria-label="Photo sets" data-open={open}>
        {sets.map((set) => (
          <Link
            key={set.slug}
            to={setPath(set)}
            className="label"
            aria-current={set.slug === currentSlug ? "page" : undefined}
            onClick={() => setOpen(false)}
          >
            {set.title}
          </Link>
        ))}
        <Link
          to={COLOPHON_PATH}
          className="label"
          aria-current={currentSlug === "colophon" ? "page" : undefined}
          onClick={() => setOpen(false)}
        >
          Colophon
        </Link>
      </nav>
    </header>
  );
}

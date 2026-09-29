import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import type { PhotoSet } from "../data/catalog";
import { setPath } from "../lib/routes";
import { clampIndex, nearestIndex } from "../lib/strip-math";
import { Frame } from "./Frame";
import { StripFooter } from "./StripFooter";

type Props = { set: PhotoSet; next: PhotoSet };

function frameOffsets(scroller: HTMLElement): number[] {
  const start = scroller.querySelector<HTMLElement>("[data-frame]")?.offsetLeft ?? 0;
  return [...scroller.querySelectorAll<HTMLElement>("[data-frame]")].map(
    (frame) => frame.offsetLeft - start,
  );
}

function maxScroll(scroller: HTMLElement): number {
  return scroller.scrollWidth - scroller.clientWidth;
}

const storageKey = (slug: string) => `dh:strip:${slug}`;

function savedPosition(slug: string): number | null {
  try {
    const value = Number(window.sessionStorage.getItem(storageKey(slug)) ?? Number.NaN);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function savePosition(slug: string, position: number): void {
  try {
    window.sessionStorage.setItem(storageKey(slug), String(Math.round(position)));
  } catch {
    // Storage is unavailable; the strip will start at the beginning next time.
  }
}

export function Strip({ set, next }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const total = set.photos.length;
  const slug = set.slug;

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const desktop = window.matchMedia("(min-width: 768px) and (min-height: 541px)");

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      if (!desktop.matches) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      element.scrollLeft += event.deltaY;
    };
    const onScroll = () => {
      setIndex(nearestIndex(frameOffsets(element), element.scrollLeft, maxScroll(element)));
      savePosition(slug, element.scrollLeft);
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("scroll", onScroll);
    };
  }, [slug]);

  useEffect(() => {
    const element = scroller.current;
    const target = decodeURIComponent(window.location.hash.slice(1));
    if (target) {
      document.getElementById(target)?.scrollIntoView({ behavior: "auto", inline: "start", block: "start" });
      return;
    }
    const saved = savedPosition(slug);
    if (element && saved !== null) element.scrollLeft = saved;
  }, [slug]);

  const go = (delta: number) => {
    const element = scroller.current;
    if (!element) return;
    const offset = frameOffsets(element)[clampIndex(index + delta, total)];
    if (offset === undefined) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollTo({
      left: Math.min(offset, maxScroll(element)),
      behavior: reduced ? "auto" : "smooth",
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      go(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(-1);
    }
  };

  return (
    <div className="set-view">
      <div className="set-heading">
        <h1>{set.title}</h1>
        <p className="label">{set.place}</p>
      </div>
      <div
        ref={scroller}
        className="strip"
        role="region"
        aria-label={`${set.title} photographs`}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {set.photos.map((photo, position) => (
          <Frame key={photo.slug} photo={photo} position={position} />
        ))}
        <Link to={setPath(next)} className="next-set" aria-label={`Next set: ${next.title}`}>
          <span className="label">Next</span>
          <span className="next-set-title">{next.title}</span>
        </Link>
      </div>
      <StripFooter
        title={set.title}
        place={set.place}
        index={index}
        total={total}
        onPrevious={() => go(-1)}
        onNext={() => go(1)}
      />
    </div>
  );
}

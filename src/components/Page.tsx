import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import type { Catalog } from "../data/catalog";
import { headFor } from "../lib/head";
import { nextSet, resolve, type Resolved } from "../lib/routes";
import { forgetPositionUnless } from "../lib/strip-position";
import { Colophon } from "./Colophon";
import { NotFound } from "./NotFound";
import { PhotoView } from "./PhotoView";
import { SiteHeader } from "./SiteHeader";
import { Strip } from "./Strip";

/** The set the visitor is in: its strip, or one of its photographs. */
function setSlug(resolved: Resolved): string | null {
  return resolved.kind === "set" || resolved.kind === "photo" ? resolved.set.slug : null;
}

function currentSlug(resolved: Resolved): string | null {
  return setSlug(resolved) ?? (resolved.kind === "colophon" ? "colophon" : null);
}

function View({ catalog, resolved }: { catalog: Catalog; resolved: Resolved }) {
  switch (resolved.kind) {
    case "set":
      return (
        <Strip
          key={resolved.set.slug}
          set={resolved.set}
          next={nextSet(catalog, resolved.set.slug)}
        />
      );
    case "photo":
      return <PhotoView set={resolved.set} photo={resolved.photo} />;
    case "colophon":
      return <Colophon />;
    case "notFound":
      return <NotFound first={catalog.sets[0]} />;
  }
}

export function Page({ catalog }: { catalog: Catalog }) {
  const { pathname, hash } = useLocation();
  const resolved = resolve(catalog, pathname);
  const { title } = headFor(resolved);
  const shown = useRef(`${pathname}${hash}`);

  useEffect(() => {
    document.title = title;
  }, [title]);

  // A set's strip keeps its place only while the visitor stays in that set.
  // Leaving for another set, or any other page, lets it go, so the set starts
  // from its first photograph the next time it is opened.
  const inSet = setSlug(resolved);
  useEffect(() => {
    forgetPositionUnless(inSet);
  }, [inSet]);

  // A client-side navigation to a URL without a hash starts at the top of the
  // page; with a hash, the strip scrolls to that frame instead. The first
  // render is a page load, where the browser owns the scroll position.
  useEffect(() => {
    const location = `${pathname}${hash}`;
    if (shown.current === location) return;
    shown.current = location;
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);

  return (
    <div className="page">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteHeader sets={catalog.sets} currentSlug={currentSlug(resolved)} />
      <main id="main" tabIndex={-1}>
        <View catalog={catalog} resolved={resolved} />
      </main>
    </div>
  );
}

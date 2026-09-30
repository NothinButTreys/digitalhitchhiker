import { useEffect } from "react";

const SITE = "Library — Digital Hitchhiker";

/** Names the browser tab, and the page for a screen reader, after the screen being shown. */
export function useTitle(screen?: string) {
  useEffect(() => {
    document.title = screen ? `${screen} — ${SITE}` : SITE;
  }, [screen]);
}

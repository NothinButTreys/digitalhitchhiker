import { useEffect, useRef, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router";
import type { Photo, PhotoSet } from "../data/catalog";
import { photoPath, setPath } from "../lib/routes";
import { Picture } from "./Picture";

type Props = { set: PhotoSet; photo: Photo };

export function PhotoView({ set, photo }: Props) {
  const navigate = useNavigate();
  const view = useRef<HTMLElement>(null);
  const previous = set.photos[photo.index - 1];
  const next = set.photos[photo.index + 1];
  const closeHref = `${setPath(set)}#${photo.slug}`;
  const ratio = Number((photo.width / photo.height).toFixed(3));
  // Desktop: the stage is bounded by the two 48px gutters and by the viewport
  // height less the 72px header and the 132px reserved in .photo-stage.
  const sizes = `(min-width: 768px) and (min-height: 541px) min(calc(100vw - 96px), calc((100vh - 204px) * ${ratio})), 100vw`;

  useEffect(() => {
    view.current?.focus();
  }, [photo.slug]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") navigate(closeHref);
    else if (event.key === "ArrowLeft" && previous) navigate(photoPath(previous));
    else if (event.key === "ArrowRight" && next) navigate(photoPath(next));
  };

  return (
    <article ref={view} className="photo-view" tabIndex={-1} onKeyDown={onKeyDown}>
      <div
        className="photo-stage"
        style={{ aspectRatio: `${photo.width} / ${photo.height}`, backgroundColor: photo.color }}
      >
        <Picture photo={photo} sizes={sizes} priority="high" />
      </div>
      <div className="photo-caption">
        <div>
          <h1>{photo.title}</h1>
          <p>{photo.description}</p>
        </div>
        <nav className="photo-nav" aria-label="Photograph">
          {previous && (
            <Link className="label" to={photoPath(previous)} aria-label="Previous photograph">
              Previous
            </Link>
          )}
          {next && (
            <Link className="label" to={photoPath(next)} aria-label="Next photograph">
              Next
            </Link>
          )}
          <Link className="label" to={closeHref} aria-label={`Back to ${set.title}`}>
            Close
          </Link>
        </nav>
      </div>
    </article>
  );
}

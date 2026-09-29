import { Link } from "react-router";
import type { Photo } from "../data/catalog";
import { photoPath } from "../lib/routes";
import { Picture } from "./Picture";

type Props = { photo: Photo; position: number };

export function Frame({ photo, position }: Props) {
  const ratio = Number((photo.width / photo.height).toFixed(3));
  const priority = position === 0 ? "high" : position === 1 ? "eager" : "lazy";

  return (
    <Link
      id={photo.slug}
      to={photoPath(photo)}
      className="frame"
      data-frame
      style={{ aspectRatio: `${photo.width} / ${photo.height}`, backgroundColor: photo.color }}
    >
      <Picture
        photo={photo}
        sizes={`(min-width: 768px) and (min-height: 541px) calc((100vh - 180px) * ${ratio}), 100vw`}
        priority={priority}
      />
    </Link>
  );
}

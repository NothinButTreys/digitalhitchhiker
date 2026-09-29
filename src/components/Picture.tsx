import type { Photo } from "../data/catalog";
import { largestUpTo, photoUrl, srcSet } from "../data/photo-url";

type Props = { photo: Photo; sizes: string; priority: "high" | "eager" | "lazy" };

export function Picture({ photo, sizes, priority }: Props) {
  return (
    <picture>
      <source type="image/avif" srcSet={srcSet(photo, "avif")} sizes={sizes} />
      <img
        src={photoUrl(photo, largestUpTo(photo, 1280), "jpg")}
        srcSet={srcSet(photo, "jpg")}
        sizes={sizes}
        alt={photo.alt}
        width={photo.width}
        height={photo.height}
        loading={priority === "lazy" ? "lazy" : "eager"}
        decoding={priority === "lazy" ? "async" : undefined}
        fetchPriority={priority === "high" ? "high" : undefined}
      />
    </picture>
  );
}

"use client";

import { ImageGrid } from "@/components/image-grid";
import { SearchResult } from "./page";
import { CloudinaryImage } from "@/components/cloudinary-image";

export default function GalleryGrid({ images }: { images: SearchResult[] }) {

  if (!images.length) {
    return (
      <div className="flex justify-center items-center h-96">
        <p className="text-3xl text-gray-400">No images found</p>
      </div>
    );
  }

  return (
    <ImageGrid
      images={images}
      getImage={(imageData: SearchResult) => {
        return (
          <CloudinaryImage
            key={imageData.public_id}
            imageData={imageData}
            width="400"
            height="300"
            alt="an image of something"
          />
        );
      }}
    />
  );
}

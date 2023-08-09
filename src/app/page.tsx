import React from "react";
import "animate.css";
import { Photo } from "./types/photos";
import ImageBlock from "./components/imageBlock";

const getAllPhotos = async () => {
  const req = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/photos`, {
    next: {
      tags: ["all-photos"],
    },
    headers: {
      "x-api-key": process.env.CLOUDINARY_CLOUD_SECRET as string
    }
  });
  const result = await req.json();
  return result?.resources as Photo[];
};

export default async function Home() {
  const photos = await getAllPhotos();

  const sortPhotosByFolder = () => {
    return photos.reduce((sortedPhotos: { [key: string]: Photo[] }, photo) => {
      if (!sortedPhotos[photo.folder]) {
        sortedPhotos[photo.folder] = [];
      }
      sortedPhotos[photo.folder].push(photo);
      return sortedPhotos;
    }, {});
  };

  return (
      <div
        className="relative p-4 top-20 animate__animated animate__fadeIn"
        id="imageGallery"
      >
        {Object.entries(sortPhotosByFolder()).map(([folderName, photos]) => (
          <ImageBlock
            key={folderName}
            folderName={folderName}
            photos={photos}
          />
        ))}
      </div>
  );
}

import React from "react";
import Image from "next/image";
import { Photo } from "../types/photos";

export default function ImageGallery({
  folderName,
  photos,
}: {
  folderName: string;
  photos: Photo[];
}) {
  return (
    <div className="relative grid grid-cols-2 gap-8 md:grid-cols-4">
      {photos.map((photo) => (
        <Image
          key={photo.public_id + folderName}
          src={photo.secure_url}
          alt={photo.public_id}
          className="rounded-lg"
          width={625}
          height={444}
        />
      ))}
      <div className="absolute px-2 py-4 shadow-md top-4 left-4 bg-black/25 rounded-2xl">
        {folderName}
      </div>
    </div>
  );
}

import React from "react";
import "animate.css";
import Loading from "./loading";
import getPhotos from "./fetchPhotos";
import {Photo} from "./types";
import ImageGallery from "./ImageGallery";


export default async function Home() {
  const results: Photo[] = await getPhotos();

  if (!results || results.length === 0) {
    return <Loading />;
  }

  const sortPhotosByFolder = (photos: Photo[]): { [key: string]: Photo[] } => {
    let sortedPhotos: { [key: string]: Photo[] } = {};
    for (let photo of photos) {
      if (!sortedPhotos[photo.folder]) {
        sortedPhotos[photo.folder] = [];
      }
      sortedPhotos[photo.folder].push(photo);
    }

    return sortedPhotos;
  };

  

  return (
    <div className="p-4 top-20 relative animate__animated animate__fadeIn" id="imageGallery">
      {Object.entries(sortPhotosByFolder(results)).map(
        ([folderName, photos]) => (
          <ImageGallery
            key={folderName}
            folderName={folderName}
            photos={photos}
          />
        )
      )}
    </div>
  );
}

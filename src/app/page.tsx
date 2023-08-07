import Image from "next/image";
import React from "react";
import "animate.css";
import Loading from "./loading";
import { getAlbums } from './server/albums'

export default async function Home() {
const albums = await getAlbums();
console.log(albums);

  // const displayAlbum = (albums: Array<string>) => {
  //     albums.map((album, i: number) => {
  //         <div className="relative" key={i + Math.random()}>
  //             <Image
  //                 src={album}
  //                 alt={album}
  //                 layout="fill"
  //                 objectFit="cover"
  //                 className="rounded-lg"
  //             />
  //         </div>;
  //     });
  //     return albums;
  // };

  if (albums.length === 0) {
    return <Loading />;
  }

  return (
    <div
      className="grid grid-cols-3 gap-2 p-4 top-20 relative"
      id="imageGallery"
    >
      {/* {displayAlbum(albums)} */}
    </div>
  );
}

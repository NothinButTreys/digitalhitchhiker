const { google } = require("googleapis");
const Photos = require("googlephotos");
const { z } = require("zod");
const { OAuth2Client } = require("google-auth-library");
import { Album } from "../store";

interface Photo {
  albumId: number;
  id: number;
  filename: string;
  baseUrl: string;
  thumbnailUrl: string;
}

const albumsSchema = z.object({
  id: z.number(),
  title: z.string(),
  imageURL: z.string()
});

const photoSchema = z.object({
  albumId: z.number(),
  id: z.number(),
  title: z.string(),
  url: z.string(),
  thumbnailUrl: z.string()
});

const auth = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URL
);

const scopes = [
  "https://www.googleapis.com/auth/photoslibrary.readonly",
  "https://www.googleapis.com/auth/photoslibrary.sharing"
];

const url = auth.generateAuthUrl({
  access_type: "offline",
  scope: scopes
});

console.log(url);

const { tokens } = OAuth2Client.getToken(url);
console.log(tokens);

export const getAlbums = async () => {
  const photos = new Photos(url);
  const albums = await photos.albums.get();

  const albumData = albums.map((album: Album) => {
    return {
      id: album.id,
      title: album.title,
      imageURL: album.coverPhotoBaseUrl
    };
  });

  return albumData;
};

//  export const getPhotos = async (albumId: number) => {
//   const photos = new Photos(auth.token);
//   const photosInAlbum = await photos.mediaItems.search(albumId);

//   const photoData = photosInAlbum.map((photo: Photo) => {
//     return {
//       albumId: albumId,
//       id: photo.id,
//       title: photo.filename,
//       url: photo.baseUrl,
//       thumbnailUrl: photo.thumbnailUrl
//     };
//   });

//   return photoData;
// };

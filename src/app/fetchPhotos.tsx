import { Photo } from "./types";
async function getPhotos() {
  const results = await fetch(
    `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/resources/image?max_results=500`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(
          process.env.CLOUDINARY_CLOUD_KEY +
            ":" +
            process.env.CLOUDINARY_CLOUD_SECRET
        ).toString("base64")}`
      }
    }
  ).then((res) => res.json());

  return results.resources as Photo[];
}

export default getPhotos;

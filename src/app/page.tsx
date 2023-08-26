import getPhotos, { type Photo } from "@/server/photos";
import Image from "next/image";

export default async function Home() {
    const photos = await getPhotos();

    const sortPhotosByFolder = (photos: Photo[]) => {
        let sortedPhotos = {} as { [key: string]: Photo[] };
        for (let photo of photos) {
            if (!sortedPhotos[photo.folder]) {
                sortedPhotos[photo.folder] = [];
            }
            // look at each photo and update the secure_url to have 'c_scale,w_450' after the word upload
            photo.secure_url = photo.secure_url.replace(
                "/upload/",
                "/upload/c_scale,w_450/"
            );

            sortedPhotos[photo.folder].push(photo);
        }

        return sortedPhotos;
    };

    return (
        <>
            <div className="w-full h-screen overflow-hidden">
                <div className="relative overflow-hidden bg-cover bg-[50%] bg-no-repeat">
                    <img
                        src="https://res.cloudinary.com/dgpqy3j6f/image/upload/v1693002835/river_35_of_35_zhn7ko.jpg"
                        alt="river"
                        className="w-full h-full object-cover"
                    />
                </div>
                {/* Tagline */}
                <div className="absolute bottom-40 left-20 container mx-auto py-4 animate__animated animate__fadeIn scroll-smooth w-fit z-20">
                    <h2 className="text-5xl font-semibold text-white/70 max-w-[550px] [text-shadow:_5px_5px_10px_rgb(0_0_0_/_60%)]">
                        Journey Through the Lens: Your Digital Passport to the
                        World
                    </h2>
                </div>
                <div className="absolute z-10 bottom-0 left-0 min-h-[50%] w-full overflow-hidden bg-gradient-to-t from-[#242424]"></div>
            </div>
            <div
                className="container flex flex-wrap mx-auto relative py-4 top-20 animate__animated animate__fadeIn scroll-smooth"
                id="imageGallery"
            >
                {Object.entries(sortPhotosByFolder(photos)).map(
                    ([folderName, photos]) => (
                        <ImageGallery
                            key={folderName}
                            folderName={folderName}
                            photos={photos}
                        />
                    )
                )}
            </div>
        </>
    );
}

function ImageGallery({
    folderName,
    photos,
}: {
    folderName: string;
    photos: Photo[];
}) {
    return (
        <>
            <div className="px-2 py-4 w-full">
                <h2 className="text-4xl font-thin text-white">{folderName}</h2>
            </div>
            <div className="relative gap-8 columns-2 md:columns-4">
                {photos.map((photo) => {
                    return (
                        <Image
                            key={photo.public_id + folderName}
                            src={photo.secure_url}
                            alt={photo.public_id}
                            className="h-auto max-w-full py-4 rounded-lg"
                            width={625}
                            height={444}
                        />
                    );
                })}
            </div>
        </>
    );
}

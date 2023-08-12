import getPhotos, { type Photo } from '@/server/photos';
import Image from 'next/image';

export default async function Home() {
	const photos = await getPhotos();

	const sortPhotosByFolder = (photos: Photo[]) => {
		let sortedPhotos = {} as { [key: string]: Photo[] };
		for (let photo of photos) {
			if (!sortedPhotos[photo.folder]) {
				sortedPhotos[photo.folder] = [];
			}
			sortedPhotos[photo.folder].push(photo);
		}

		return sortedPhotos;
	};

	return (
		<div
			className="relative p-4 top-20 animate__animated animate__fadeIn"
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
		<div className="relative gap-8 columns-2 md:columns-4">
			{photos.map((photo) => (
				<Image
					key={photo.public_id + folderName}
					src={photo.secure_url}
					alt={photo.public_id}
					className="h-auto max-w-full py-4 rounded-lg"
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

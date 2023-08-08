import React from 'react'
import { Photo } from './types';
import Image from 'next/image';

export default function ImageGallery({
    folderName,
    photos,
    }: {
    folderName: string;
    photos: Photo[];
}) {
    return (
        <div className='columns-2 md:columns-4 gap-8 relative'>
            {photos.map((photo) => (
                <Image
                    key={photo.public_id + folderName}
                    src={photo.secure_url}
                    alt={photo.public_id}
                    className="h-auto max-w-full rounded-lg py-4"
                    width={625}
                    height={444}
                />
            ))}
            <div className='py-4 px-2 absolute top-4 left-4 bg-black/25 rounded-2xl shadow-md'>{folderName}</div>
        </div>
    );
}

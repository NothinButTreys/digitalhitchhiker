import { z } from 'zod';

export const photoSchema = z.object({
	asset_id: z.string(),
	public_id: z.string(),
	format: z.string(),
	version: z.number(),
	resource_type: z.string(),
	type: z.string(),
	created_at: z.string(),
	bytes: z.number(),
	width: z.number(),
	height: z.number(),
	url: z.string(),
	secure_url: z.string(),
	folder: z.string(),
});

export type Photo = z.infer<typeof photoSchema>;

async function getPhotos() {
	const results = await fetch(
		`https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/resources/image?max_results=500`,
		{
			method: 'GET',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Basic ${Buffer.from(
					process.env.CLOUDINARY_CLOUD_KEY +
						':' +
						process.env.CLOUDINARY_CLOUD_SECRET
				).toString('base64')}`,
			},
		}
	);

	const res = await results.json();
	if (!res?.resources?.length) {
		return [];
	}

	return res.resources as Photo[];
}

export default getPhotos;

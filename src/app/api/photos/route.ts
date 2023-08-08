import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("x-api-key");
  if (authHeader !== process.env.CLOUDINARY_CLOUD_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/resources/image?max_results=500`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(
          `${process.env.CLOUDINARY_CLOUD_KEY}:${process.env.CLOUDINARY_CLOUD_SECRET}`
        ).toString("base64")}`,
      },
    }
  );

  if (!res.ok) {
    return new Response("Something went wrong", { status: 500 });
  }

  const data = await res.json();
  return NextResponse.json(data);
}

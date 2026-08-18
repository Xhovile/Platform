import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export function isSupportedUploadMime(mime: string): boolean {
  return mime.startsWith("image/") || mime.startsWith("video/");
}

export async function uploadBufferToCloudinary(file: {
  buffer: Buffer;
  mimetype: string;
}): Promise<string> {
  if (!file.mimetype || !isSupportedUploadMime(file.mimetype)) {
    throw new Error("Unsupported file type");
  }

  const b64 = Buffer.from(file.buffer).toString("base64");
  const dataURI = `data:${file.mimetype};base64,${b64}`;

  const result = await cloudinary.uploader.upload(dataURI, {
    resource_type: "auto",
  });

  return result.secure_url;
}

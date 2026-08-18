export type ListingImageRole = "thumbnail" | "card" | "detail" | "fullscreen";

export const LISTING_IMAGE_PRESETS: Record<
  ListingImageRole,
  { width: number; quality: string }
> = {
  // Small gallery previews. Fast to download and cache.
  thumbnail: { width: 160, quality: "auto:low" },
  // Listing/category cards. 480px is intentionally enough for crisp card rendering
  // while avoiding the cost of downloading the original upload.
  card: { width: 480, quality: "auto:eco" },
  // Listing details should show the original uploaded image so the user can inspect
  // its actual resolution and visual detail without an artificial delivery ceiling.
  detail: { width: 0, quality: "original" },
  // Fullscreen also uses the original stored image at native source quality.
  fullscreen: { width: 0, quality: "original" },
};

function transformCloudinaryUrl(
  src: string | null | undefined,
  transformation: string,
) {
  if (!src) return "";
  if (!src.includes("res.cloudinary.com") || !src.includes("/upload/")) {
    return src;
  }
  return src.replace("/upload/", `/upload/${transformation}/`);
}

export function getListingImageUrl(
  src: string | null | undefined,
  role: ListingImageRole,
) {
  if (!src) return "";

  if (role === "detail" || role === "fullscreen") {
    return src;
  }

  const preset = LISTING_IMAGE_PRESETS[role];
  return transformCloudinaryUrl(
    src,
    `f_auto,q_${preset.quality},w_${preset.width},c_limit`,
  );
}

// Backward-compatible helper retained for callers that may still reference it.
// The image UI no longer renders a blurred LQIP placeholder.
export function getListingImagePlaceholderUrl(_src: string | null | undefined) {
  return "";
}

// Backward-compatible helpers for callers not yet migrated to getListingImageUrl.
export const getOptimizedImageUrl = (src: string | null | undefined, width = 540) =>
  transformCloudinaryUrl(src, `f_auto,q_auto,w_${width},c_limit`);
export const getListingCardImageUrl = (src: string | null | undefined) =>
  getListingImageUrl(src, "card");
export const getListingGalleryThumbUrl = (src: string | null | undefined) =>
  getListingImageUrl(src, "thumbnail");
export const getListingDetailImageUrl = (src: string | null | undefined) =>
  getListingImageUrl(src, "detail");
export const getListingFullscreenImageUrl = (src: string | null | undefined) =>
  getListingImageUrl(src, "fullscreen");

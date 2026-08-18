import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { postgresDb as db } from "../db.js";
import { v2 as cloudinary } from "cloudinary";
import { getFirebaseAdmin } from "./firebaseAdmin.js";
import { deleteAllPasskeysForUser, deletePasskeyCeremoniesForUser } from "./passkeyStore.js";
import { disableTotpEnrollment } from "../../src/server/totpStore.js";

type VerifiedRequestUser = {
  uid: string;
  email: string | null;
  email_verified: boolean;
  is_admin: boolean;
};

const ROUTES_INSTALLED_FLAG = Symbol.for("buymesho.accountDeletionRoutesInstalled");

db.pragma("foreign_keys = ON");

function verifyBearerIdentity(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Missing Authorization Bearer token" });

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing Authorization Bearer token" });
  }

  void getFirebaseAdmin()
    .auth()
    .verifyIdToken(token.trim())
    .then((decoded) => {
      req.user = {
        uid: decoded.uid,
        email: decoded.email ?? null,
        email_verified: (decoded as any).email_verified === true,
        is_admin: (decoded as any).admin === true || (decoded as any).role === "admin",
      } as VerifiedRequestUser;
      next();
    })
    .catch(() => res.status(401).json({ error: "Invalid or expired token" }));
}

function parseJsonArray(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function collectCloudinaryUrls(record: {
  business_logo?: string | null;
  profile_picture?: string | null;
  proof_document_url?: string | null;
  photos?: string | null;
  video_url?: string | null;
}) {
  const urls = new Set<string>();

  for (const maybeUrl of [
    record.business_logo,
    record.profile_picture,
    record.proof_document_url,
    record.video_url,
  ]) {
    if (typeof maybeUrl === "string" && maybeUrl.trim()) urls.add(maybeUrl.trim());
  }

  for (const photoUrl of parseJsonArray(record.photos)) {
    urls.add(photoUrl);
  }

  return [...urls];
}

function parseCloudinaryAsset(rawUrl: string): { publicId: string; resourceType: "image" | "video" } | null {
  try {
    const url = new URL(rawUrl);
    const marker = "/upload/";
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex === -1) return null;

    const afterUpload = url.pathname.slice(markerIndex + marker.length);
    const segments = afterUpload.split("/").filter(Boolean);
    if (!segments.length) return null;

    const versionIndex = segments.findIndex((segment) => /^v\d+$/.test(segment));
    const publicSegments = versionIndex >= 0 ? segments.slice(versionIndex + 1) : segments;
    if (!publicSegments.length) return null;

    publicSegments[publicSegments.length - 1] =
      publicSegments[publicSegments.length - 1].replace(/\.[^.]+$/, "");

    return {
      publicId: publicSegments.join("/"),
      resourceType: url.pathname.includes("/video/upload/") ? "video" : "image",
    };
  } catch {
    return null;
  }
}

async function destroyCloudinaryAsset(rawUrl: string) {
  const asset = parseCloudinaryAsset(rawUrl);
  if (!asset) return;

  try {
    await cloudinary.uploader.destroy(asset.publicId, {
      resource_type: asset.resourceType,
    });
  } catch (error) {
    console.warn("Failed to delete Cloudinary asset:", rawUrl, error);
  }
}

function collectUserMediaUrls(userId: string) {
  const sellerRow = db
    .prepare(`SELECT business_logo FROM sellers WHERE uid = ? LIMIT 1`)
    .get(userId) as { business_logo?: string | null } | undefined;
  
  const listingRows = db
    .prepare(`SELECT photos, video_url FROM listings WHERE seller_uid = ?`)
    .all(userId) as { photos?: string | null; video_url?: string | null }[];

  const applicationRows = db
    .prepare(`SELECT proof_document_url FROM seller_applications WHERE applicant_uid = ?`)
    .all(userId) as { proof_document_url?: string | null }[];

  const urls = new Set<string>();

  if (sellerRow) collectCloudinaryUrls(sellerRow).forEach((url) => urls.add(url));
  for (const listing of listingRows) collectCloudinaryUrls(listing).forEach((url) => urls.add(url));
  for (const application of applicationRows) collectCloudinaryUrls(application).forEach((url) => urls.add(url));

  return [...urls];
}

async function purgeCloudinaryUrls(urls: string[]) {
  await Promise.allSettled(urls.map((url) => destroyCloudinaryAsset(url)));
}

function cleanupUserRecords(userId: string) {
  const transaction = db.transaction((uid: string) => {
    db.prepare(
      `DELETE FROM reports WHERE reporter_uid = ? OR listing_id IN (SELECT id FROM listings WHERE seller_uid = ?)`
    ).run(uid, uid);

    db.prepare(`DELETE FROM seller_ratings WHERE seller_uid = ? OR rater_uid = ?`).run(uid, uid);
    db.prepare(`DELETE FROM listing_reviews WHERE seller_uid = ? OR reviewer_uid = ?`).run(uid, uid);
    db.prepare(`DELETE FROM seller_applications WHERE applicant_uid = ?`).run(uid);
    db.prepare(`DELETE FROM listings WHERE seller_uid = ?`).run(uid);
    db.prepare(`DELETE FROM sellers WHERE uid = ?`).run(uid);
  });

  transaction(userId);
}

async function accountDeletionHandler(req: Request, res: Response) {
  const user = req.user as VerifiedRequestUser | undefined;
  if (!user) return res.status(401).json({ error: "Authentication required" });

  try {
    const urls = collectUserMediaUrls(user.uid);
    await Promise.all([
      deleteAllPasskeysForUser(user.uid),
      deletePasskeyCeremoniesForUser(user.uid),
    ]);
    disableTotpEnrollment(user.uid);
    cleanupUserRecords(user.uid);

    res.json({
      success: true,
      message: "Account and related data deleted successfully.",
    });

    setImmediate(() => {
      void purgeCloudinaryUrls(urls).catch((error) => {
        console.warn("Cloudinary cleanup after account deletion failed:", error);
      });
    });
  } catch (error) {
    console.error("Account deletion cleanup failed:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to delete account data",
    });
  }
}

export function registerAccountDeletionRoutes(app: Express) {
  if ((app as any)[ROUTES_INSTALLED_FLAG]) return;

  app.delete("/api/account/delete", verifyBearerIdentity, accountDeletionHandler);
  (app as any)[ROUTES_INSTALLED_FLAG] = true;
}

import type { Express } from "express";
import { getFirebaseAdmin } from "./firebaseAdmin.js";
import { requireFirebaseUser } from "../middleware/requireFirebaseUser.js";
import { postgresDb as db } from "../db.js";

const ROUTES_INSTALLED_FLAG = Symbol.for("buymesho.accountRoutesInstalled");

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function registerAccountRoutes(app: Express) {
  if ((app as any)[ROUTES_INSTALLED_FLAG]) return;

  app.put("/api/account", requireFirebaseUser, async (req: any, res) => {
    const uid = String(req.user?.uid ?? "").trim();
    if (!uid) return res.status(401).json({ error: "Authentication required" });

    const university = normalizeString(req.body?.university);
    const profilePicture = normalizeString(req.body?.profile_picture);
    const hasBusinessFields =
      Object.prototype.hasOwnProperty.call(req.body ?? {}, "business_name") ||
      Object.prototype.hasOwnProperty.call(req.body ?? {}, "business_logo") ||
      Object.prototype.hasOwnProperty.call(req.body ?? {}, "bio");
    const businessName = normalizeString(req.body?.business_name);
    const businessLogo = normalizeString(req.body?.business_logo);
    const bio = normalizeString(req.body?.bio);

    try {
      const firebaseAdmin = getFirebaseAdmin();
      await firebaseAdmin.firestore().collection("users").doc(uid).set(
        {
          ...(university ? { university } : {}),
          profile_picture: profilePicture || null,
          updated_at: new Date().toISOString(),
        },
        { merge: true },
      );

      if (university || hasBusinessFields) {
        try {
          const sellerUpdates: string[] = [];
          const sellerParams: unknown[] = [];

          if (university) {
            sellerUpdates.push("university = ?");
            sellerParams.push(university);
          }

          if (hasBusinessFields) {
            sellerUpdates.push("business_name = ?");
            sellerParams.push(businessName || null);
            sellerUpdates.push("business_logo = ?");
            sellerParams.push(businessLogo || null);
            sellerUpdates.push("bio = ?");
            sellerParams.push(bio || null);
          }

          if (sellerUpdates.length > 0) {
            sellerParams.push(uid);
            db.prepare(
              `UPDATE sellers
               SET ${sellerUpdates.join(", ")}
               WHERE uid = ?`,
            ).run(...sellerParams);
          }
        } catch (error) {
          console.warn("Failed to sync account fields to seller record", error);
        }
      }

      let seller: any = null;
      try {
        seller = db
          .prepare(
            `SELECT uid, email, business_name, business_logo, university, bio, is_verified, is_seller, join_date
             FROM sellers
             WHERE uid = ?
             LIMIT 1`,
          )
          .get(uid);
      } catch (error) {
        console.warn("Failed to reload seller record after account update", error);
      }

      return res.json({
        success: true,
        profile: {
          uid,
          email: seller?.email ?? req.user?.email ?? "",
          university: university || seller?.university || null,
          profile_picture: profilePicture || null,
          business_name: seller?.business_name ?? null,
          business_logo: seller?.business_logo ?? null,
          bio: seller?.bio ?? null,
          is_verified: !!seller?.is_verified,
          is_seller: !!seller?.is_seller,
          join_date: seller?.join_date ?? null,
        },
      });
    } catch (error) {
      console.error("Failed to update account", error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to update account",
      });
    }
  });

  (app as any)[ROUTES_INSTALLED_FLAG] = true;
}

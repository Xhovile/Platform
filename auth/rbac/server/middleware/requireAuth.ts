import type { Request, Response, NextFunction } from "express";
import { getTotpEnrollment, verifyTotpVerifiedSession } from "../../src/server/totpStoreCompat.js";
import { readTotpSessionCookie } from "../auth/totpSessionCookie.js";
import { resolveCanonicalIdentity } from "../auth/canonicalAuth.js";

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await resolveCanonicalIdentity(req);
    if (!user) {
      return res.status(401).json({ error: "Invalid or missing authentication token" });
    }

    const enrollment = getTotpEnrollment(user.uid);
    const totpEnabled = enrollment?.status === "enabled";
    const totpSessionToken = readTotpSessionCookie(req);
    const totpVerified =
      !totpEnabled ||
      (!!totpSessionToken && verifyTotpVerifiedSession(user.uid, totpSessionToken));

    if (!totpVerified) {
      return res.status(401).json({ error: "Two-factor verification required" });
    }

    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export async function attachOptionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = await resolveCanonicalIdentity(req);
    if (!user) return next();

    const enrollment = getTotpEnrollment(user.uid);
    const totpEnabled = enrollment?.status === "enabled";
    const totpSessionToken = readTotpSessionCookie(req);
    const totpVerified =
      !totpEnabled ||
      (!!totpSessionToken && verifyTotpVerifiedSession(user.uid, totpSessionToken));

    if (!totpVerified) return next();

    req.user = user;
    return next();
  } catch {
    return next();
  }
}

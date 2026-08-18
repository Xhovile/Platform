import type { NextFunction, Request, Response } from "express";
import { isConfiguredAdmin } from "./adminAccess.js";
import { verifyIdToken } from "./firebaseAdmin.js";
import { normalizeUserRole, type UserRole } from "./rbac.js";

export type CanonicalRequestUser = {
  uid: string;
  email: string | null;
  email_verified: boolean;
  role: UserRole | null;
  is_admin: boolean;
};

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, ...parts] = header.trim().split(/\s+/);
  if (scheme !== "Bearer" || parts.length !== 1) return null;
  const token = parts[0]?.trim();
  return token || null;
}

export async function resolveCanonicalIdentity(req: Request): Promise<CanonicalRequestUser | null> {
  const token = getBearerToken(req);
  if (!token) return null;
  try {
    const decoded = await verifyIdToken(token, true);
    const uid = decoded.uid;
    const email = decoded.email ?? null;
    const claimRole = normalizeUserRole((decoded as any).role);
    const claimAdmin = (decoded as any).admin === true;
    const legacyAdmin = !claimRole && !claimAdmin && isConfiguredAdmin({ uid, email });
    const role = claimRole ?? (claimAdmin || legacyAdmin ? "admin" : null);

    return {
      uid,
      email,
      email_verified: decoded.email_verified === true,
      role,
      is_admin: role === "admin",
    };
  } catch {
    return null;
  }
}

export async function requireCanonicalIdentity(req: Request, res: Response, next: NextFunction) {
  const user = await resolveCanonicalIdentity(req);
  if (!user) return res.status(401).json({ error: "Invalid or missing authentication token" });
  req.user = user;
  return next();
}

export async function attachCanonicalIdentity(req: Request, _res: Response, next: NextFunction) {
  const user = await resolveCanonicalIdentity(req);
  if (user) req.user = user;
  return next();
}

import type { Express, Request } from "express";
import { createTotpAuthRouter, type AuthUserContext } from "../src/server/authRoutes.js";
import { verifyIdToken } from "./auth/firebaseAdmin.js";

export async function resolveTotpUser(req: Request): Promise<AuthUserContext | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const idToken = authHeader.slice(7).trim();
  if (!idToken) return null;

  try {
    const decoded = await verifyIdToken(idToken);
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      displayName: decoded.name ?? null,
    };
  } catch {
    return null;
  }
}

export function mountTotpRoutes(app: Express) {
  app.use(
    "/api/totp",
    createTotpAuthRouter({
      resolveUser: resolveTotpUser,
    })
  );
}

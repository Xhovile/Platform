import { Router, type Request, type Response } from "express";
import {
  buildOtpAuthUri,
  generateTotpSecret,
  verifyTotpCode,
} from "./totpService.js";
import {
  confirmTotpEnrollment,
  createTotpVerifiedSession,
  disableTotpEnrollment,
  getTotpEnrollment,
  getTotpEnrollmentSummary,
  setTotpStatus,
  upsertTotpEnrollment,
} from "./totpStoreCompat.js";
import { getTotpDisplayName, normalizeTotpCode, type TotpMfaStatus } from "../lib/totp.js";
import { clearTotpSessionCookie, setTotpSessionTokenCookie } from "../../server/auth/totpSessionCookie.js";

export type AuthUserContext = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
};

export type TotpAuthRoutesDeps = {
  resolveUser: (req: Request) => Promise<AuthUserContext | null> | AuthUserContext | null;
};

type JsonResponse = { ok: true; data?: unknown };
type ErrorResponse = { ok: false; error: string };

function sendOk(res: Response, data?: unknown) {
  return res.json({ ok: true, data } satisfies JsonResponse);
}

function sendError(res: Response, status: number, error: string) {
  return res.status(status).json({ ok: false, error } satisfies ErrorResponse);
}

function requireString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function getUserContext(req: Request, resolveUser: TotpAuthRoutesDeps["resolveUser"]): Promise<AuthUserContext | null> {
  const resolved = await resolveUser(req);
  return resolved ?? null;
}

export function createTotpAuthRouter(deps: TotpAuthRoutesDeps) {
  const router = Router();

  router.get("/status", async (req, res) => {
    const user = await getUserContext(req, deps.resolveUser);
    if (!user) return sendError(res, 401, "Login required.");

    const summary = getTotpEnrollmentSummary(user.uid);
    return sendOk(res, {
      status: summary?.status ?? ("disabled" satisfies TotpMfaStatus),
      enrolledAt: summary?.enrolledAt ?? null,
      confirmedAt: summary?.confirmedAt ?? null,
      issuer: summary?.issuer ?? null,
      accountName: summary?.accountName ?? getTotpDisplayName(user.displayName ?? null, user.email ?? null),
      hasSecret: !!summary,
    });
  });

  router.post("/enroll/start", async (req, res) => {
    const user = await getUserContext(req, deps.resolveUser);
    if (!user) return sendError(res, 401, "Login required.");

    const accountName = requireString(req.body?.accountName) || getTotpDisplayName(user.displayName ?? null, user.email ?? null);
    const issuer = requireString(req.body?.issuer) || undefined;

    const secret = generateTotpSecret();
    const record = upsertTotpEnrollment({
      userId: user.uid,
      email: user.email ?? null,
      secret,
      issuer,
      accountName,
    });

    const otpauthUri = buildOtpAuthUri({
      issuer: record.issuer,
      accountName: record.accountName,
      secret: record.secret,
    });

    return sendOk(res, {
      status: record.status,
      secret: record.secret,
      otpauthUri,
      issuer: record.issuer,
      accountName: record.accountName,
      enrolledAt: record.enrolledAt,
      confirmedAt: record.confirmedAt,
    });
  });

  router.post("/enroll/confirm", async (req, res) => {
    const user = await getUserContext(req, deps.resolveUser);
    if (!user) return sendError(res, 401, "Login required.");

    const code = normalizeTotpCode(requireString(req.body?.code));
    if (!code) return sendError(res, 400, "A 6-digit code is required.");

    const record = getTotpEnrollment(user.uid);
    if (!record) return sendError(res, 404, "No pending TOTP enrollment found.");

    const result = verifyTotpCode({ secret: record.secret, code });
    if (result.ok === false) {
      return sendError(res, 400, result.reason === "clock_skew" ? "That code has expired." : "Invalid TOTP code.");
    }

    const confirmed = confirmTotpEnrollment(user.uid);
    if (!confirmed) return sendError(res, 500, "Failed to confirm TOTP enrollment.");

    const session = createTotpVerifiedSession(user.uid);
    setTotpSessionTokenCookie(res, session.token, session.expiresAt);
    return sendOk(res, {
      status: confirmed.status,
      confirmedAt: confirmed.confirmedAt,
      sessionExpiresAt: session.expiresAt,
    });
  });

  router.post("/challenge/verify", async (req, res) => {
    const user = await getUserContext(req, deps.resolveUser);
    if (!user) return sendError(res, 401, "Login required.");

    const code = normalizeTotpCode(requireString(req.body?.code));
    if (!code) return sendError(res, 400, "A 6-digit code is required.");

    const record = getTotpEnrollment(user.uid);
    if (!record || record.status !== "enabled") {
      return sendError(res, 400, "Two-factor authentication is not enabled for this account.");
    }

    const result = verifyTotpCode({ secret: record.secret, code });
    if (result.ok === false) {
      return sendError(res, 400, result.reason === "clock_skew" ? "That code has expired." : "Invalid authenticator code.");
    }

    const session = createTotpVerifiedSession(user.uid);
    setTotpSessionTokenCookie(res, session.token, session.expiresAt);
    return sendOk(res, {
      verified: true,
      status: record.status,
      expiresAt: session.expiresAt,
    });
  });

  router.delete("/session", (_req, res) => {
    clearTotpSessionCookie(res);
    return res.status(204).end();
  });

  router.post("/disable", async (req, res) => {
    const user = await getUserContext(req, deps.resolveUser);
    if (!user) return sendError(res, 401, "Login required.");

    const removed = disableTotpEnrollment(user.uid);
    clearTotpSessionCookie(res);
    return sendOk(res, { removed });
  });

  return router;
}

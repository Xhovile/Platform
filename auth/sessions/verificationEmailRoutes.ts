import express, { type Express, type NextFunction, type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { getFirebaseAdmin } from "./firebaseAdmin.js";
import { sendEmail } from "../modules/email/email.service.js";
import { renderVerificationEmail } from "../modules/email/templates/verification.js";

type VerifiedRequestUser = {
  uid: string;
  email: string | null;
  email_verified: boolean;
  is_admin: boolean;
};

const ROUTES_INSTALLED_FLAG = Symbol.for("buymesho.verificationEmailRoutesInstalled");

const resendVerificationLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many verification email requests. Please wait a few minutes and try again.",
  },
  keyGenerator: (req: Request) => {
    const user = (req as Request & { user?: VerifiedRequestUser }).user;
    return user?.uid ?? ipKeyGenerator(req.ip ?? "unknown");
  },
});

function getAppUrl() {
  return process.env.APP_URL?.trim() || "http://localhost:3000";
}

async function verifyBearerIdentity(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header) {
      return res.status(401).json({ error: "Missing Authorization Bearer token" });
    }

    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({ error: "Missing Authorization Bearer token" });
    }

    const decoded = await getFirebaseAdmin().auth().verifyIdToken(token.trim());

    req.user = {
      uid: decoded.uid,
      email: decoded.email ?? null,
      email_verified: (decoded as any).email_verified === true,
      is_admin: (decoded as any).admin === true || (decoded as any).role === "admin",
    } as VerifiedRequestUser;

    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

async function sendVerificationEmail(params: { email: string; displayName?: string | null }) {
  const admin = getFirebaseAdmin();
  const loginUrl = `${getAppUrl().replace(/\/$/, "")}/login`;
  const verificationLink = await admin.auth().generateEmailVerificationLink(params.email, {
    url: loginUrl,
    handleCodeInApp: false,
  });

  const recipientName = params.displayName?.trim() || params.email.split("@")[0] || "there";
  const { text, html } = renderVerificationEmail({
    recipientName,
    verificationLink,
  });

  await sendEmail({
    sender: "transactional",
    to: {
      email: params.email,
      name: recipientName,
    },
    subject: "Verify your BuyMesho email address",
    text,
    html,
  });
}

async function verificationEmailHandler(req: Request, res: Response) {
  const user = req.user as VerifiedRequestUser | undefined;
  const email = user?.email?.trim();

  if (!user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  if (!email) {
    return res.status(400).json({ error: "No email address is attached to this account" });
  }

  if (user.email_verified) {
    return res.json({ success: true, alreadyVerified: true, message: "Email is already verified." });
  }

  const displayName =
    typeof req.body?.display_name === "string" && req.body.display_name.trim().length > 0
      ? req.body.display_name.trim()
      : null;

  try {
    await sendVerificationEmail({ email, displayName });
    return res.json({
      success: true,
      message: "Verification email sent successfully.",
    });
  } catch (error) {
    console.error("Failed to send verification email:", error);
    return res.status(500).json({
      error:
        error instanceof Error ? error.message : "Failed to send verification email",
    });
  }
}

function registerVerificationEmailRoutes(app: Express) {
  if ((app as any)[ROUTES_INSTALLED_FLAG]) {
    return;
  }

  app.post("/api/auth/send-verification-email", verifyBearerIdentity, verificationEmailHandler);
  app.post(
    "/api/auth/resend-verification-email",
    verifyBearerIdentity,
    resendVerificationLimiter,
    verificationEmailHandler,
  );

  (app as any)[ROUTES_INSTALLED_FLAG] = true;
}

export { registerVerificationEmailRoutes };

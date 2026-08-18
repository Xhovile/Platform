import rateLimit from "express-rate-limit";
import type { Express, Request, Response } from "express";
import { getFirebaseAdmin } from "./firebaseAdmin.js";
import { sendEmail } from "../modules/email/email.service.js";
import { renderEmailChangeEmail } from "../modules/email/templates/email-change.js";

type VerifiedRequestUser = {
  uid: string;
  email: string | null;
};

const ROUTES_INSTALLED_FLAG = Symbol.for("buymesho.emailChangeRoutesInstalled");

const emailChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many email change requests. Please wait and try again later.",
  },
});

async function verifyBearerIdentity(req: Request, res: Response, next: () => void) {
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
    } as VerifiedRequestUser;

    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

async function emailChangeHandler(req: Request, res: Response) {
  const user = req.user as VerifiedRequestUser | undefined;
  const currentEmail = user?.email?.trim();
  const newEmail = typeof req.body?.new_email === "string" ? req.body.new_email.trim().toLowerCase() : "";

  if (!user?.uid) {
    return res.status(401).json({ error: "Authentication required" });
  }

  if (!currentEmail) {
    return res.status(400).json({ error: "No current email address is attached to this account." });
  }

  if (!newEmail) {
    return res.status(400).json({ error: "New email address is required." });
  }

  if (newEmail === currentEmail.toLowerCase()) {
    return res.status(400).json({ error: "The new email must be different from the current email." });
  }

  try {
    const firebaseAdmin = getFirebaseAdmin();
    const currentUser = await firebaseAdmin.auth().getUser(user.uid);

    if (currentUser.email?.trim().toLowerCase() !== currentEmail.toLowerCase()) {
      return res.status(409).json({ error: "Your account email changed. Please refresh and try again." });
    }

    const verificationLink = await firebaseAdmin.auth().generateVerifyAndChangeEmailLink(
      currentEmail,
      newEmail,
      {
        url: "https://buymesho.app/email-action",
        handleCodeInApp: false,
      },
    );

    const recipientName = currentUser.displayName?.trim() || currentEmail.split("@")[0] || "there";
    const { text, html } = renderEmailChangeEmail({
      recipientName,
      newEmail,
      verificationLink,
    });

    await sendEmail({
      sender: "transactional",
      to: {
        email: newEmail,
        name: recipientName,
      },
      subject: "Confirm your BuyMesho email change",
      text,
      html,
    });

    return res.json({
      success: true,
      message: "A verification link was sent to your new email address.",
    });
  } catch (error: any) {
    if (error?.code === "auth/email-already-exists") {
      return res.status(409).json({ error: "That email address is already in use." });
    }

    console.error("Failed to send email change verification:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to send email change verification",
    });
  }
}

export function registerEmailChangeRoutes(app: Express) {
  if ((app as any)[ROUTES_INSTALLED_FLAG]) return;

  app.post("/api/auth/send-email-change-verification", verifyBearerIdentity, emailChangeLimiter, emailChangeHandler);
  (app as any)[ROUTES_INSTALLED_FLAG] = true;
}

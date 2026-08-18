import rateLimit from "express-rate-limit";
import type { Express, Request, Response } from "express";
import { getFirebaseAdmin } from "./firebaseAdmin.js";
import { sendEmail } from "../modules/email/email.service.js";
import { renderPasswordResetEmail } from "../modules/email/templates/password-reset.js";

const ROUTES_INSTALLED_FLAG = Symbol.for("buymesho.passwordResetEmailRoutesInstalled");

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many password reset requests. Please wait and try again.",
  },
});

async function passwordResetHandler(req: Request, res: Response) {
  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";

  if (!email) {
    return res.status(400).json({ error: "Email address is required." });
  }

  try {
    const resetLink = await getFirebaseAdmin().auth().generatePasswordResetLink(email);
    const recipientName = email.split("@")[0] || "there";
    const { text, html } = renderPasswordResetEmail({ recipientName, resetLink });

    await sendEmail({
      sender: "transactional",
      to: { email, name: recipientName },
      subject: "Reset your BuyMesho password",
      text,
      html,
    });

    return res.json({
      success: true,
      message: "Password reset email sent.",
    });
  } catch (error: any) {
    if (error?.code === "auth/user-not-found") {
      return res.status(404).json({ error: "No account found for that email address." });
    }

    console.error("Failed to send password reset email:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to send password reset email",
    });
  }
}

export function registerPasswordResetEmailRoutes(app: Express) {
  if ((app as any)[ROUTES_INSTALLED_FLAG]) return;

  app.post("/api/auth/send-password-reset-email", passwordResetLimiter, passwordResetHandler);
  (app as any)[ROUTES_INSTALLED_FLAG] = true;
}

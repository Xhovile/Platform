import rateLimit from "express-rate-limit";
import type { Express, Request, Response } from "express";
import { getFirebaseAdmin } from "./firebaseAdmin.js";

const ROUTES_INSTALLED_FLAG = Symbol.for("buymesho.loginEmailCheckRoutesInstalled");

const loginEmailCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many email checks. Please wait a moment and try again.",
  },
});

function isValidEmailFormat(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function loginEmailCheckHandler(req: Request, res: Response) {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";

  if (!email || !isValidEmailFormat(email)) {
    return res.status(400).json({
      registered: false,
      code: "invalid-email",
      error: "Please enter a valid email address.",
    });
  }

  try {
    const user = await getFirebaseAdmin().auth().getUserByEmail(email);

    if (user.disabled) {
      return res.status(200).json({
        registered: true,
        disabled: true,
        error: "This account is currently unavailable. Please contact BuyMesho Support.",
      });
    }

    return res.status(200).json({ registered: true, disabled: false });
  } catch (error: any) {
    if (error?.code === "auth/user-not-found") {
      return res.status(404).json({
        registered: false,
        code: "email-not-registered",
        error: "This email address is not registered with BuyMesho.",
      });
    }

    console.error("Failed to check login email:", error);
    return res.status(500).json({
      registered: false,
      code: "check-failed",
      error: "We could not verify this email address right now. Please try again.",
    });
  }
}

export function registerLoginEmailCheckRoutes(app: Express) {
  if ((app as any)[ROUTES_INSTALLED_FLAG]) return;

  app.post("/api/auth/check-login-email", loginEmailCheckLimiter, loginEmailCheckHandler);
  (app as any)[ROUTES_INSTALLED_FLAG] = true;
}

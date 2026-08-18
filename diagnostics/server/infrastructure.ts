import type { Express } from "express";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import type { DiagnosticPayload } from "./types.js";

function configured(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export function registerInfrastructureDiagnosticsRoutes(app: Express) {
  app.get("/api/diagnostics/infrastructure", async (_req, res) => {
    const started = Date.now();
    let firebase = false;
    let firebaseError: string | undefined;

    try {
      const admin = getFirebaseAdmin();
      firebase = admin.apps.length > 0;
    } catch (error) {
      firebaseError = error instanceof Error ? error.message : String(error);
    }

    const groups = {
      cloudinary: ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"],
      smtp: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"],
      paychangu: ["PAYCHANGU_SECRET_KEY", "PAYCHANGU_WEBHOOK_SECRET"],
      admin: ["ADMIN_EMAILS", "ADMIN_UIDS"],
    } as const;

    const checks: NonNullable<DiagnosticPayload["checks"]> = {
      firebase: {
        status: firebase ? "PASS" : "FAIL",
        message: firebase ? "Firebase Admin initialized" : "Firebase Admin is unavailable",
        details: firebaseError ? { error: firebaseError } : { apps: 1 },
      },
      database_url: {
        status: configured("DATABASE_URL") ? "PASS" : "FAIL",
        message: configured("DATABASE_URL") ? "DATABASE_URL is configured" : "DATABASE_URL is not configured",
        details: { configured: configured("DATABASE_URL") },
      },
    };

    for (const [label, names] of Object.entries(groups)) {
      const present = names.filter(configured);
      const status = present.length === names.length ? "PASS" : "WARN";
      checks[label] = {
        status,
        message: status === "PASS" ? `${label} is configured` : `${label} is partially or not configured`,
        details: { configured: present, missing: names.filter((name) => !present.includes(name)) },
      };
    }

    const statuses = Object.values(checks).map((check) => check.status);
    const overall = statuses.includes("FAIL") ? "FAIL" : statuses.includes("WARN") ? "WARN" : "PASS";
    const payload: DiagnosticPayload = {
      overall,
      authoritative: true,
      diagnostic_version: "3.0",
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - started,
      checks,
    };

    res.status(overall === "FAIL" ? 503 : 200).setHeader("Cache-Control", "no-store").json(payload);
  });
}

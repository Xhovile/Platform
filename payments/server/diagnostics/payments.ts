import type { Express } from "express";
import { PAYMENT_ENDPOINTS } from "../modules/payments/payment.endpoints.js";
import { paymentWebhookHandler } from "../modules/payments/payment.webhooks.js";
import { payoutWebhookHandler } from "../modules/payouts/payout.webhooks.js";
import type { DiagnosticPayload } from "./types.js";

export function registerPaymentDiagnosticsRoutes(app: Express) {
  app.get("/api/diagnostics/payments", async (_req, res) => {
    const started = Date.now();
    const expected = {
      initialize: "/api/payments/paychangu/initialize",
      verify: "/api/payments/paychangu/verify/:txRef",
      webhook: "/api/payments/paychangu/webhook",
      payoutWebhook: "/api/payments/paychangu-payout/webhook",
    } as const;

    const actual = PAYMENT_ENDPOINTS.paychangu as Record<string, string | undefined>;
    const mismatches = Object.fromEntries(
      Object.entries(expected)
        .filter(([key, value]) => actual[key] !== value)
        .map(([key, value]) => [key, { expected: value, actual: actual[key] }]),
    );
    const endpointsOk = Object.keys(mismatches).length === 0;
    const webhooksOk = typeof paymentWebhookHandler === "function" && typeof payoutWebhookHandler === "function";
    const status = endpointsOk && webhooksOk ? "PASS" : "FAIL";

    const payload: DiagnosticPayload = {
      overall: status,
      authoritative: true,
      diagnostic_version: "3.0",
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - started,
      checks: {
        endpoint_contract: {
          status: endpointsOk ? "PASS" : "FAIL",
          message: endpointsOk ? "Payment endpoint contract matches" : "Payment endpoint contract mismatch",
          details: { mismatches },
        },
        webhook_exports: {
          status: webhooksOk ? "PASS" : "FAIL",
          message: webhooksOk ? "Payment and payout webhook handlers are exported" : "Webhook handler exports are missing",
          details: { paymentWebhookHandler: typeof paymentWebhookHandler === "function", payoutWebhookHandler: typeof payoutWebhookHandler === "function" },
        },
        environment: {
          status: process.env.PAYCHANGU_SECRET_KEY?.trim() && process.env.PAYCHANGU_WEBHOOK_SECRET?.trim() ? "PASS" : "WARN",
          message: process.env.PAYCHANGU_SECRET_KEY?.trim() && process.env.PAYCHANGU_WEBHOOK_SECRET?.trim() ? "PayChangu credentials are configured" : "PayChangu credentials are partially or not configured",
          details: {
            PAYCHANGU_SECRET_KEY: Boolean(process.env.PAYCHANGU_SECRET_KEY?.trim()),
            PAYCHANGU_WEBHOOK_SECRET: Boolean(process.env.PAYCHANGU_WEBHOOK_SECRET?.trim()),
          },
        },
      },
    };

    res.status(status === "FAIL" ? 503 : 200).setHeader("Cache-Control", "no-store").json(payload);
  });
}

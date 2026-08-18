import type { Express } from "express";
import { registerDatabaseDiagnosticsRoutes } from "./database.js";
import { registerBusinessDiagnosticsRoutes } from "./business.js";
import { registerPaymentDiagnosticsRoutes } from "./payments.js";
import { registerInfrastructureDiagnosticsRoutes } from "./infrastructure.js";
import { registerApiDiagnosticsRoutes } from "./api.js";
import { registerMessagingDiagnosticsRoutes } from "./messaging.js";
import type { DiagnosticPayload, NamedCheck } from "./types.js";

type DiagnosticResponse = DiagnosticPayload;

function localBaseUrl(): string {
  const port = process.env.PORT ?? "10000";
  return `http://127.0.0.1:${port}`;
}

async function fetchDiagnostic(path: string): Promise<DiagnosticResponse> {
  const response = await fetch(new URL(path, localBaseUrl()), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : { overall: "FAIL", error: await response.text() };

  if (!body || typeof body !== "object") {
    return {
      overall: "FAIL",
      authoritative: true,
      diagnostic_version: "4.0",
      timestamp: new Date().toISOString(),
      duration_ms: 0,
      error: `${path} returned an invalid diagnostic payload`,
    };
  }

  return body as DiagnosticResponse;
}

function combineOverall(values: string[]): "PASS" | "WARN" | "FAIL" {
  if (values.includes("FAIL")) return "FAIL";
  if (values.includes("WARN")) return "WARN";
  return "PASS";
}

export function registerDiagnosticsRoutes(app: Express, _deps?: { db?: any }) {
  registerDatabaseDiagnosticsRoutes(app);
  registerBusinessDiagnosticsRoutes(app);
  registerPaymentDiagnosticsRoutes(app);
  registerInfrastructureDiagnosticsRoutes(app);
  registerApiDiagnosticsRoutes(app);
  registerMessagingDiagnosticsRoutes(app);

  app.get("/api/diagnostics", async (_req, res) => {
    const started = Date.now();
    const paths = {
      database: "/api/diagnostics/database",
      business: "/api/diagnostics/business",
      payments: "/api/diagnostics/payments",
      infrastructure: "/api/diagnostics/infrastructure",
      api: "/api/diagnostics/api",
      messaging: "/api/diagnostics/messaging",
    } as const;

    try {
      const results = await Promise.all(
        Object.entries(paths).map(async ([key, path]) => [key, await fetchDiagnostic(path)] as const),
      );

      const checks: Record<string, NamedCheck> = {};
      const statuses: string[] = [];

      for (const [key, result] of results) {
        statuses.push(result.overall);
        if (result.checks) {
          for (const [checkKey, check] of Object.entries(result.checks)) {
            checks[`${key}.${checkKey}`] = check;
          }
        } else {
          checks[key] = {
            status: result.overall,
            message: result.error ?? `${key} diagnostic completed`,
          };
        }
      }

      const overall = combineOverall(statuses);
      const payload: DiagnosticPayload = {
        overall,
        authoritative: true,
        diagnostic_version: "4.1",
        timestamp: new Date().toISOString(),
        duration_ms: Date.now() - started,
        checks,
      };

      res
        .status(overall === "FAIL" ? 503 : 200)
        .setHeader("Cache-Control", "no-store")
        .json(payload);
    } catch (error) {
      res.status(503).setHeader("Cache-Control", "no-store").json({
        overall: "FAIL",
        authoritative: true,
        diagnostic_version: "4.1",
        timestamp: new Date().toISOString(),
        duration_ms: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      } satisfies DiagnosticPayload);
    }
  });
}

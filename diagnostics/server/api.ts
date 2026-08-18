import type { Express } from "express";
import type { DiagnosticPayload } from "./types.js";

type EndpointResult = {
  status: "PASS" | "WARN" | "FAIL";
  message: string;
  details: Record<string, unknown>;
};

async function checkEndpoint(
  baseUrl: string,
  path: string,
  expectedStatus: number,
  validateBody: (body: unknown) => { ok: boolean; message: string; details?: Record<string, unknown> },
): Promise<EndpointResult> {
  const started = Date.now();
  try {
    const response = await fetch(new URL(path, baseUrl), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    const latencyMs = Date.now() - started;
    const contentType = response.headers.get("content-type") ?? "";
    let body: unknown = null;

    if (contentType.includes("application/json")) {
      try {
        body = await response.json();
      } catch {
        body = null;
      }
    } else {
      body = await response.text();
    }

    if (response.status !== expectedStatus) {
      return {
        status: "FAIL",
        message: `${path} returned HTTP ${response.status}; expected ${expectedStatus}`,
        details: {
          http_status: response.status,
          latency_ms: latencyMs,
          content_type: contentType,
        },
      };
    }

    const validation = validateBody(body);
    return {
      status: validation.ok ? "PASS" : "FAIL",
      message: validation.message,
      details: {
        http_status: response.status,
        latency_ms: latencyMs,
        content_type: contentType,
        ...(validation.details ?? {}),
      },
    };
  } catch (error) {
    return {
      status: "FAIL",
      message: `${path} request failed: ${error instanceof Error ? error.message : String(error)}`,
      details: { latency_ms: Date.now() - started },
    };
  }
}

function validateEvents(body: unknown) {
  const items =
    typeof body === "object" && body !== null && Array.isArray((body as { items?: unknown }).items)
      ? (body as { items: unknown[] }).items
      : null;

  return {
    ok: items !== null,
    message: items !== null ? "/api/events returned a valid items array" : "/api/events response shape is invalid",
    details: { records_returned: items?.length ?? 0 },
  };
}

function validateProtectedContract(_body: unknown) {
  return {
    ok: true,
    message: "Protected endpoint is reachable and authentication can be validated separately",
    details: { response_shape_checked: false },
  };
}

function getDiagnosticBaseUrl() {
  const explicitBaseUrl = process.env.DIAGNOSTIC_BASE_URL ?? process.env.INTERNAL_API_BASE_URL;
  if (explicitBaseUrl) {
    return explicitBaseUrl.replace(/\/$/, "");
  }

  const port = process.env.PORT ?? "10000";
  return `http://127.0.0.1:${port}`;
}

export function registerApiDiagnosticsRoutes(app: Express) {
  app.get("/api/diagnostics/api", async (_req, res) => {
    const started = Date.now();
    const baseUrl = getDiagnosticBaseUrl();

    const events = await checkEndpoint(baseUrl, "/api/events", 200, validateEvents);

    const protectedChecks = {
      profile: await checkEndpoint(baseUrl, "/api/profile", 401, validateProtectedContract),
      cart: await checkEndpoint(baseUrl, "/api/cart", 401, validateProtectedContract),
      messages_inbox: await checkEndpoint(baseUrl, "/api/messages/inbox", 401, validateProtectedContract),
    };

    const checks = {
      events,
      ...protectedChecks,
    };
    const statuses = Object.values(checks).map((check) => check.status);
    const overall = statuses.includes("FAIL") ? "FAIL" : statuses.includes("WARN") ? "WARN" : "PASS";

    const payload: DiagnosticPayload = {
      overall,
      authoritative: true,
      diagnostic_version: "3.3",
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - started,
      checks,
    };

    res.status(overall === "FAIL" ? 503 : 200).setHeader("Cache-Control", "no-store").json(payload);
  });
}

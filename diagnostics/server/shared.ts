import type { CheckStatus, NamedCheck } from "./types.js";

export function statusWeight(status: CheckStatus): number {
  return status === "FAIL" ? 2 : status === "WARN" ? 1 : 0;
}

export function combineStatus(checks: NamedCheck[]): CheckStatus {
  const worst = checks.reduce((max, check) => Math.max(max, statusWeight(check.status)), 0);
  return worst === 2 ? "FAIL" : worst === 1 ? "WARN" : "PASS";
}

export function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function checkEnvironment(name: string, required = false): NamedCheck {
  const configured = Boolean(process.env[name]?.trim());
  return {
    status: configured ? "PASS" : required ? "FAIL" : "WARN",
    message: configured ? `${name} is configured` : `${name} is not configured`,
    details: { configured },
  };
}

export function checkEnvironmentGroup(
  names: string[],
  label: string,
  mode: "all" | "any" = "all",
): NamedCheck {
  const configured = names.filter((name) => Boolean(process.env[name]?.trim()));
  const complete = mode === "any" ? configured.length > 0 : configured.length === names.length;
  return {
    status: complete ? "PASS" : "WARN",
    message: complete ? `${label} is configured` : `${label} is partially or not configured`,
    details: { configured, missing: names.filter((name) => !configured.includes(name)) },
  };
}

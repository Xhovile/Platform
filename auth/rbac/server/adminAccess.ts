import { hasAdminRole, normalizeUserRole, type UserRole } from "./rbac.js";

export type AdminIdentity = {
  email?: string | null;
  uid?: string | null;
  role?: string | null;
  is_admin?: boolean;
};

function parseCsvEnv(value: string | undefined, normalizeLowercase = false): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => {
      const trimmed = item.trim();
      return normalizeLowercase ? trimmed.toLowerCase() : trimmed;
    })
    .filter(Boolean);
}

export function getConfiguredAdminEmails(): string[] {
  return parseCsvEnv(process.env.ADMIN_EMAILS, true);
}

export function getConfiguredAdminUids(): string[] {
  return parseCsvEnv(process.env.ADMIN_UIDS);
}

export function isConfiguredAdmin(identity?: Pick<AdminIdentity, "email" | "uid">): boolean {
  const email = typeof identity?.email === "string" ? identity.email.trim().toLowerCase() : "";
  if (email && getConfiguredAdminEmails().includes(email)) return true;

  const uid = typeof identity?.uid === "string" ? identity.uid.trim() : "";
  if (uid && getConfiguredAdminUids().includes(uid)) return true;

  return false;
}

export function getUserRole(identity?: AdminIdentity): UserRole | null {
  const explicitRole = normalizeUserRole(identity?.role);
  if (explicitRole) return explicitRole;

  // Legacy migration fallback. New authorization should use the Firebase
  // custom `role` claim; ADMIN_UIDS/ADMIN_EMAILS remain only to avoid
  // breaking existing administrators during claim migration.
  if (identity?.is_admin === true || isConfiguredAdmin(identity)) return "admin";
  return null;
}

export function hasAdminAccess(identity?: AdminIdentity): boolean {
  return hasAdminRole({
    role: getUserRole(identity),
    is_admin: identity?.is_admin === true,
  });
}

export const USER_ROLES = [
  "buyer",
  "seller",
  "validator",
  "support",
  "moderator",
  "finance_admin",
  "admin",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export type RoleIdentity = {
  role?: string | null;
  is_admin?: boolean;
};

export function normalizeUserRole(value: unknown): UserRole | null {
  if (typeof value !== "string") return null;
  const role = value.trim().toLowerCase();
  return (USER_ROLES as readonly string[]).includes(role) ? (role as UserRole) : null;
}

export function hasRole(identity: RoleIdentity | undefined, requiredRole: UserRole): boolean {
  const role = normalizeUserRole(identity?.role);
  if (role === requiredRole) return true;
  if (requiredRole === "admin" && identity?.is_admin === true) return true;
  return false;
}

export function hasAdminRole(identity: RoleIdentity | undefined): boolean {
  return hasRole(identity, "admin");
}

export function isPrivilegedRole(role: UserRole | null): boolean {
  return role === "admin" || role === "finance_admin" || role === "moderator" || role === "support";
}

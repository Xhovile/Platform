import type { User } from "firebase/auth";

const hasAdminClaim = async (user: User) => {
  try {
    const tokenResult = await user.getIdTokenResult();
    return tokenResult.claims.admin === true || tokenResult.claims.role === "admin";
  } catch (error) {
    console.warn("Failed to read admin claims", error);
    return false;
  }
};

export const resolveIsAdminUser = async (user: User | null | undefined) => {
  if (!user) return false;

  if (await hasAdminClaim(user)) return true;

  try {
    const token = await user.getIdToken();
    const response = await fetch("/api/admin/access", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) return false;
    const result = await response.json();
    return result?.isAdmin === true;
  } catch {
    return false;
  }
};

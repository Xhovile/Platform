import type { User as FirebaseUser } from "firebase/auth";
import type { UserProfile } from "../types";

/**
 * Returns the best available avatar URL for a user, preferring the
 * profile-picture stored in the app database over the Firebase photoURL.
 */
export function getAvatarUrl(
  profile: UserProfile | null | undefined,
  firebaseUser: FirebaseUser | null | undefined
): string | null {
  return (
    profile?.profile_picture ||
    profile?.business_logo ||
    firebaseUser?.photoURL ||
    null
  );
}

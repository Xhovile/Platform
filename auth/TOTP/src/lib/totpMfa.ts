import { auth } from "../firebase";
import {
  getMultiFactorResolver,
  multiFactor,
  TotpMultiFactorGenerator,
} from "firebase/auth";

export type TotpEnrollmentPayload = {
  secret: any;
  secretKey: string;
  qrCodeUrl: string;
  accountName: string;
  issuer: string;
};

export type TotpFactorHint = {
  uid: string;
  factorId: string;
  displayName?: string | null;
  phoneNumber?: string | null;
};

export function getTotpHints(resolver: any): TotpFactorHint[] {
  const hints = Array.isArray(resolver?.hints) ? resolver.hints : [];
  return hints.filter((hint: TotpFactorHint) => hint?.factorId === TotpMultiFactorGenerator.FACTOR_ID);
}

export function getTotpResolver(error: any) {
  return getMultiFactorResolver(auth, error);
}

export async function beginTotpEnrollment(currentUser: any, issuer = "BuyMesho"): Promise<TotpEnrollmentPayload> {
  const session = await multiFactor(currentUser).getSession();
  const secret = await TotpMultiFactorGenerator.generateSecret(session);
  const accountName = currentUser.email || "BuyMesho user";

  return {
    secret,
    secretKey: secret.secretKey,
    qrCodeUrl: secret.generateQrCodeUrl(accountName, issuer),
    accountName,
    issuer,
  };
}

export async function completeTotpEnrollment(
  currentUser: any,
  secret: any,
  verificationCode: string,
  displayName: string
) {
  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(
    secret,
    verificationCode.trim()
  );

  await multiFactor(currentUser).enroll(assertion, displayName.trim() || "Authenticator app");
}

export function buildTotpSignInAssertion(enrollmentId: string, verificationCode: string) {
  return TotpMultiFactorGenerator.assertionForSignIn(
    enrollmentId,
    verificationCode.trim()
  );
}

import admin from "firebase-admin";

/**
 * Priority:
 * 1) FIREBASE_SERVICE_ACCOUNT_JSON (Codespaces / CI / private env)
 * 2) Application Default Credentials (fallback with explicit projectId)
 */
function getCredential() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (json && json.trim().length > 0) {
    try {
      const serviceAccount = JSON.parse(json);
      return {
        credential: admin.credential.cert({
          projectId: serviceAccount.project_id,
          clientEmail: serviceAccount.client_email,
          privateKey: (serviceAccount.private_key as string).replace(/\\n/g, "\n"),
        }),
        projectId: serviceAccount.project_id as string,
      };
    } catch (err) {
      console.warn("[firebaseAdmin] Invalid FIREBASE_SERVICE_ACCOUNT_JSON, falling back to default credential", err);
    }
  }

  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    "campusmarket-da919";

  return {
    credential: admin.credential.applicationDefault(),
    projectId,
  };
}

export function getFirebaseAdmin() {
  if (!admin.apps.length) {
    const { credential, projectId } = getCredential();
    admin.initializeApp({
      credential,
      projectId,
    });
  }
  return admin;
}

export async function verifyIdToken(idToken: string, checkRevoked = false) {
  const adminApp = getFirebaseAdmin();

  try {
    return await adminApp.auth().verifyIdToken(idToken, checkRevoked);
  } catch (error) {
    console.error(
      `[firebaseAdmin] ID Token verification failed: ${
        error instanceof Error ? error.message : error
      }`,
    );
    throw error;
  }
}

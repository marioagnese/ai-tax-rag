import "server-only";
import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

function env(name: string) {
  return process.env[name] || "";
}

function hasFirebaseAdminEnv() {
  return !!(env("FIREBASE_PROJECT_ID") && env("FIREBASE_CLIENT_EMAIL") && env("FIREBASE_PRIVATE_KEY"));
}

export function firebaseAdminConfigured() {
  return hasFirebaseAdminEnv();
}

export function getAdminApp(): App {
  if (!hasFirebaseAdminEnv()) {
    throw new Error("Firebase Admin is not configured (missing FIREBASE_* env vars).");
  }

  if (getApps().length) return getApps()[0]!;

  // Vercel env often stores multiline keys with \n
  const privateKey = env("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n");

  return initializeApp({
    credential: cert({
      projectId: env("FIREBASE_PROJECT_ID"),
      clientEmail: env("FIREBASE_CLIENT_EMAIL"),
      privateKey,
    }),
  });
}

export function getAdminAuth() {
  const app = getAdminApp();
  return getAuth(app);
}

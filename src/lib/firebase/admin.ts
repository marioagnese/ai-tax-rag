import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// Prefer full JSON if provided; else build from discrete fields.
function getServiceAccount() {
  const json = process.env.FIREBASE_ADMIN_CREDENTIALS_JSON;
  if (json) return JSON.parse(json);

  const projectId = requireEnv("FIREBASE_PROJECT_ID");
  const clientEmail = requireEnv("FIREBASE_CLIENT_EMAIL");
  const privateKey = requireEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n");

  return { projectId, clientEmail, privateKey };
}

export function getAdminApp(): App {
  if (getApps().length) return getApps()[0]!;
  const sa = getServiceAccount();

  return initializeApp({
    credential: cert(sa),
    projectId: sa.projectId,
  });
}

export function adminAuth() {
  return getAuth(getAdminApp());
}

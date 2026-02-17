import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;

type FirebasePublicConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
};

/**
 * IMPORTANT:
 * In Next.js, NEXT_PUBLIC_* values are statically inlined into the client bundle
 * at build time. Dynamic access like process.env[name] can fail/return empty.
 * So we must reference them directly as literals.
 */
function getPublicEnv() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
  };
}

export function firebaseClientConfigured(): boolean {
  const e = getPublicEnv();
  return !!(e.apiKey && e.authDomain && e.projectId && e.appId);
}

function requirePublicEnv(name: keyof ReturnType<typeof getPublicEnv>): string {
  const v = getPublicEnv()[name];
  if (!v) throw new Error(`Missing env var: NEXT_PUBLIC_FIREBASE_${name.toUpperCase()}`);
  return v;
}

function getFirebaseConfig(): FirebasePublicConfig {
  // validate lazily (prevents import-time crashes)
  return {
    apiKey: requirePublicEnv("apiKey"),
    authDomain: requirePublicEnv("authDomain"),
    projectId: requirePublicEnv("projectId"),
    appId: requirePublicEnv("appId"),
  };
}

export function getFirebaseClientApp(): FirebaseApp {
  if (_app) return _app;

  const existing = getApps();
  if (existing.length) {
    _app = existing[0]!;
    return _app;
  }

  _app = initializeApp(getFirebaseConfig());
  return _app;
}

export function getFirebaseAuth(): Auth {
  if (_auth) return _auth;

  /**
   * IMPORTANT (Next.js build/prerender):
   * Next may evaluate client modules during build and prerender pipelines.
   * This helper remains safe because:
   * - config validation is lazy
   * - callers should only use auth interactions in client components
   */
  _auth = getAuth(getFirebaseClientApp());
  return _auth;
}

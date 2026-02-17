// src/lib/firebase/client.ts
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

function env(name: string): string {
  // In Next.js client bundles, only NEXT_PUBLIC_* are inlined.
  // This helper keeps access consistent and centralized.
  return process.env[name] || "";
}

export function firebaseClientConfigured(): boolean {
  return !!(
    env("NEXT_PUBLIC_FIREBASE_API_KEY") &&
    env("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN") &&
    env("NEXT_PUBLIC_FIREBASE_PROJECT_ID") &&
    env("NEXT_PUBLIC_FIREBASE_APP_ID")
  );
}

function requirePublicEnv(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getFirebaseConfig(): FirebasePublicConfig {
  // IMPORTANT: validate lazily (prevents import-time crashes)
  return {
    apiKey: requirePublicEnv("NEXT_PUBLIC_FIREBASE_API_KEY"),
    authDomain: requirePublicEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"),
    projectId: requirePublicEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
    appId: requirePublicEnv("NEXT_PUBLIC_FIREBASE_APP_ID"),
  };
}

export function getFirebaseClientApp(): FirebaseApp {
  if (_app) return _app;

  // If an app already exists (HMR / multi-import), reuse it.
  const existing = getApps();
  if (existing.length) {
    _app = existing[0]!;
    return _app;
  }

  // Allow creating the app only when configured. This throws a clear error
  // (and avoids weird Firebase internals errors).
  const cfg = getFirebaseConfig();
  _app = initializeApp(cfg);
  return _app;
}

export function getFirebaseAuth(): Auth {
  if (_auth) return _auth;

  // Auth should only be used in the browser. If someone accidentally imports
  // this helper in a server context, fail with a clear message.
  if (typeof window === "undefined") {
    throw new Error("getFirebaseAuth() called on the server (client-only).");
  }

  _auth = getAuth(getFirebaseClientApp());
  return _auth;
}

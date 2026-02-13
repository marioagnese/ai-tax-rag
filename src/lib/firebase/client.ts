// src/lib/firebase/client.ts
import "client-only";
import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export function getFirebaseClientApp() {
  if (getApps().length) return getApps()[0]!;
  return initializeApp({
    apiKey: requireEnv("NEXT_PUBLIC_FIREBASE_API_KEY"),
    authDomain: requireEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"),
    projectId: requireEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
    appId: requireEnv("NEXT_PUBLIC_FIREBASE_APP_ID"),
  });
}

export function getFirebaseAuth() {
  return getAuth(getFirebaseClientApp());
}

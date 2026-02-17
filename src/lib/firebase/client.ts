// src/lib/firebase/client.ts
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;

function env(name: string) {
  return process.env[name] || "";
}

export function firebaseClientConfigured() {
  return !!(
    env("NEXT_PUBLIC_FIREBASE_API_KEY") &&
    env("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN") &&
    env("NEXT_PUBLIC_FIREBASE_PROJECT_ID") &&
    env("NEXT_PUBLIC_FIREBASE_APP_ID")
  );
}

function requirePublicEnv(name: string) {
  const v = env(name);
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getFirebaseConfig() {
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
  if (getApps().length) {
    _app = getApps()[0]!;
    return _app;
  }
  _app = initializeApp(getFirebaseConfig());
  return _app;
}

export function getFirebaseAuth(): Auth {
  if (_auth) return _auth;
  _auth = getAuth(getFirebaseClientApp());
  return _auth;
}

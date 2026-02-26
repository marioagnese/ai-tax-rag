// src/lib/auth/session.ts
import "server-only";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE_NAME = "ai_tax_rag_session";

export type SessionUser = {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
};

type SessionPayload = SessionUser & {
  iat: number;
  exp: number;
};

function env(name: string): string {
  return process.env[name] || "";
}

// Next 15/16: cookies() may be async. This wrapper works either way.
async function cookieStore() {
  const c: any = cookies();
  return typeof c?.then === "function" ? await c : c;
}

// token = base64url(payloadJson) + "." + base64url(hmacSha256(payloadB64))
function b64urlEncode(buf: Buffer) {
  return buf
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function isB64Url(s: string) {
  // base64url charset only
  return /^[A-Za-z0-9\-_]+$/.test(s);
}

function b64urlDecodeToBuffer(s: string) {
  if (!s || !isB64Url(s)) throw new Error("Invalid base64url");

  const mod = s.length % 4;
  const padded = s + (mod === 0 ? "" : "=".repeat(4 - mod));
  const b64 = padded.replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(b64, "base64");
}

function safeJsonParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function sign(payloadB64: string, secret: string) {
  const sig = createHmac("sha256", secret).update(payloadB64).digest();
  return b64urlEncode(sig);
}

function constantTimeEqualB64Url(aB64Url: string, bB64Url: string): boolean {
  try {
    const a = b64urlDecodeToBuffer(aB64Url);
    const b = b64urlDecodeToBuffer(bB64Url);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function sanitizeUser(user: SessionUser): SessionUser | null {
  if (!user || typeof user !== "object") return null;
  const uid = (user as any).uid;
  if (typeof uid !== "string" || uid.trim().length === 0) return null;

  const email = (user as any).email;
  const name = (user as any).name;
  const picture = (user as any).picture;

  return {
    uid: uid.trim(),
    email: typeof email === "string" && email.trim() ? email.trim() : undefined,
    name: typeof name === "string" && name.trim() ? name.trim() : undefined,
    picture: typeof picture === "string" && picture.trim() ? picture.trim() : undefined,
  };
}

export function mintSessionToken(user: SessionUser, ttlSeconds = 60 * 60 * 24 * 7) {
  const secret = env("SESSION_SECRET");
  if (!secret) {
    // If env missing, fail loudly at the call site (login flow),
    // but do NOT crash page renders on verify/get.
    throw new Error("Missing env var: SESSION_SECRET");
  }

  const clean = sanitizeUser(user);
  if (!clean) throw new Error("Invalid session user");

  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    ...clean,
    iat: now,
    exp: now + Math.max(1, ttlSeconds),
  };

  const payloadJson = JSON.stringify(payload);
  const payloadB64 = b64urlEncode(Buffer.from(payloadJson, "utf8"));
  const sigB64 = sign(payloadB64, secret);

  return `${payloadB64}.${sigB64}`;
}

export function verifySessionToken(token: string): SessionUser | null {
  try {
    // If secret missing, treat as not logged in (do NOT crash pages)
    const secret = env("SESSION_SECRET");
    if (!secret) return null;

    if (!token || typeof token !== "string") return null;

    // Strict token shape (exactly one dot)
    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const payloadB64 = parts[0]?.trim();
    const sigB64 = parts[1]?.trim();
    if (!payloadB64 || !sigB64) return null;

    // base64url guard (avoid weird unicode / whitespace)
    if (!isB64Url(payloadB64) || !isB64Url(sigB64)) return null;

    const expectedSigB64 = sign(payloadB64, secret);

    // constant-time compare
    if (!constantTimeEqualB64Url(sigB64, expectedSigB64)) return null;

    const payloadJson = b64urlDecodeToBuffer(payloadB64).toString("utf8");
    const payload = safeJsonParse<Partial<SessionPayload>>(payloadJson);
    if (!payload) return null;

    const now = Math.floor(Date.now() / 1000);

    // Required fields
    if (typeof payload.uid !== "string" || payload.uid.trim().length === 0) return null;
    if (typeof payload.iat !== "number" || !Number.isFinite(payload.iat)) return null;
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return null;

    // Expiration (and basic sanity)
    if (now >= payload.exp) return null;
    if (payload.exp <= payload.iat) return null;

    // Optional extra sanity: reject tokens that claim to be issued way in the future
    if (payload.iat > now + 60) return null; // allow 60s clock skew

    return sanitizeUser({
      uid: payload.uid,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    });
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string, maxAgeSeconds = 60 * 60 * 24 * 7) {
  const store = await cookieStore();

  const maxAge = Math.max(1, maxAgeSeconds);
  const expires = new Date(Date.now() + maxAge * 1000);

  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
    expires,
  });
}

export async function clearSessionCookie() {
  const store = await cookieStore();

  // Prefer delete if available (Next supports it), and also set an expired cookie as fallback.
  try {
    if (typeof store.delete === "function") {
      store.delete(SESSION_COOKIE_NAME);
    }
  } catch {
    // ignore
  }

  store.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookieStore();
  const token = store.get(SESSION_COOKIE_NAME)?.value || "";
  if (!token) return null;
  return verifySessionToken(token);
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}
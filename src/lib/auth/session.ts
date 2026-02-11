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

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// token = base64url(payloadJson) + "." + base64url(hmacSha256(payloadB64))
function b64urlEncode(buf: Buffer) {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function b64urlDecodeToBuffer(s: string) {
  const pad = 4 - (s.length % 4 || 4);
  const padded = s + "=".repeat(pad === 4 ? 0 : pad);
  const b64 = padded.replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(b64, "base64");
}

function sign(payloadB64: string) {
  const secret = requireEnv("SESSION_SECRET");
  const sig = createHmac("sha256", secret).update(payloadB64).digest();
  return b64urlEncode(sig);
}

function safeJsonParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export function mintSessionToken(user: SessionUser, ttlSeconds = 60 * 60 * 24 * 7) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    iat: now,
    exp: now + ttlSeconds,
    user,
  };

  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sigB64 = sign(payloadB64);
  return `${payloadB64}.${sigB64}`;
}

export function verifySessionToken(token: string): SessionUser | null {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, sigB64] = parts;

  // Constant-time signature check
  const expectedSigB64 = sign(payloadB64);
  const a = b64urlDecodeToBuffer(sigB64);
  const b = b64urlDecodeToBuffer(expectedSigB64);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  const payloadJson = b64urlDecodeToBuffer(payloadB64).toString("utf8");
  const payload = safeJsonParse<{ exp: number; user: SessionUser }>(payloadJson);
  if (!payload?.user?.uid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) return null;

  return payload.user;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies(); // Next 16: cookies() is async
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

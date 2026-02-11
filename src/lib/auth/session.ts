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
  const mod = s.length % 4;
  const padded = s + (mod === 0 ? "" : "=".repeat(4 - mod));
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

async function cookieStore() {
  const c: any = cookies();
  return typeof c?.then === "function" ? await c : c;
}

/**
 * Creates a signed session token with an exp timestamp.
 */
export function mintSessionToken(user: SessionUser, ttlSeconds = 60 * 60 * 24 * 7) {
  const payload = {
    v: 1,
    ...user,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };

  const payloadJson = JSON.stringify(payload);
  const payloadB64 = b64urlEncode(Buffer.from(payloadJson, "utf8"));
  const sigB64 = sign(payloadB64);

  return `${payloadB64}.${sigB64}`;
}

/**
 * Verifies token signature + expiry, returns user if valid else null.
 */
export function verifySessionToken(token: string): SessionUser | null {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, sigB64] = parts;

  // verify signature (timing safe)
  const expected = sign(payloadB64);
  const a = Buffer.from(sigB64, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  // decode payload
  const payloadBuf = b64urlDecodeToBuffer(payloadB64);
  const payload = safeJsonParse<any>(payloadBuf.toString("utf8"));
  if (!payload?.uid || !payload?.exp) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) return null;

  const user: SessionUser = {
    uid: String(payload.uid),
    email: payload.email ? String(payload.email) : undefined,
    name: payload.name ? String(payload.name) : undefined,
    picture: payload.picture ? String(payload.picture) : undefined,
  };

  return user;
}

/**
 * Reads session cookie and returns user or null.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const cs = await cookieStore();
  const token = cs.get(SESSION_COOKIE_NAME)?.value || "";
  return verifySessionToken(token);
}

/**
 * Requires a valid session, else throws.
 */
export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

/**
 * Helper to set / clear cookie (used by login/logout routes).
 */
export async function setSessionCookie(token: string, maxAgeSeconds = 60 * 60 * 24 * 7) {
  const cs = await cookieStore();
  cs.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

export async function clearSessionCookie() {
  const cs = await cookieStore();
  cs.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

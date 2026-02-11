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

type SessionPayload = {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
  iat: number; // seconds
  exp: number; // seconds
};

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// token = base64url(payloadJson) + "." + base64url(hmacSha256(payloadB64))
function b64urlEncode(buf: Buffer) {
  return buf
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function b64urlDecodeToBuffer(s: string) {
  const padLen = (4 - (s.length % 4)) % 4;
  const padded = s + "=".repeat(padLen);
  const b64 = padded.replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(b64, "base64");
}

function sign(payloadB64: string) {
  const secret = requireEnv("SESSION_SECRET");
  const sig = createHmac("sha256", secret).update(payloadB64).digest();
  return b64urlEncode(sig);
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function mintSessionToken(user: SessionUser, ttlSeconds = 60 * 60 * 24 * 7) {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    uid: user.uid,
    email: user.email,
    name: user.name,
    picture: user.picture,
    iat: now,
    exp: now + ttlSeconds,
  };

  const payloadJson = JSON.stringify(payload);
  const payloadB64 = b64urlEncode(Buffer.from(payloadJson, "utf8"));
  const sigB64 = sign(payloadB64);
  return `${payloadB64}.${sigB64}`;
}

export function verifySessionToken(token: string): SessionUser | null {
  try {
    const [payloadB64, sigB64] = token.split(".");
    if (!payloadB64 || !sigB64) return null;

    const expected = sign(payloadB64);
    if (!safeEqual(sigB64, expected)) return null;

    const payloadBuf = b64urlDecodeToBuffer(payloadB64);
    const payload = JSON.parse(payloadBuf.toString("utf8")) as Partial<SessionPayload>;

    const now = Math.floor(Date.now() / 1000);
    if (!payload.uid) return null;
    if (typeof payload.exp !== "number" || payload.exp <= now) return null;

    return {
      uid: payload.uid,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    };
  } catch {
    return null;
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies(); // Next 16: cookies() is async
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function requireSessionUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new Error("UNAUTHORIZED");
  return u;
}

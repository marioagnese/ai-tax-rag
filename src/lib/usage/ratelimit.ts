// src/lib/usage/ratelimit.ts
import { Redis } from "@upstash/redis";

type Tier = 0 | 1 | 2;

type RateLimitMeta = {
  tier: Tier;
  limit: number; // use -1 to represent unlimited in meta/headers
  used: number;
  remaining: number; // -1 if unlimited
  resetAt: string; // ISO
  key: string;
  clientId: string;
};

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getRedis() {
  // Upstash REST env vars (Vercel recommended names)
  const url = requireEnv("UPSTASH_REDIS_REST_URL");
  const token = requireEnv("UPSTASH_REDIS_REST_TOKEN");
  return new Redis({ url, token });
}

function clampTier(x: unknown): Tier {
  const s = String(x ?? "").trim();
  if (s === "2") return 2;
  if (s === "1") return 1;
  return 0;
}

export function getTierFromRequest(req: Request): Tier {
  // TEMP: header-based tiering. Later: derive from user record (Stripe).
  return clampTier(req.headers.get("x-taxaipro-tier"));
}

function sha1Like(input: string) {
  // Lightweight non-crypto hash (stable). Avoid node crypto for edge portability.
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

export function getClientId(req: Request): string {
  // Prefer stable user id if your middleware/session puts it in headers (optional)
  const uid =
    req.headers.get("x-taxaipro-uid") ||
    req.headers.get("x-user-id") ||
    req.headers.get("x-session-uid");

  if (uid && uid.trim()) return `u:${uid.trim()}`;

  // Fallback: IP + UA hash
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "0.0.0.0";
  const ua = req.headers.get("user-agent") || "";
  return `ip:${ip}:${sha1Like(ua)}`;
}

function tierLimit(tier: Tier): number {
  // Your requested tiers:
  // 0 = 5/day, 1 = 25/day, 2 = unlimited
  if (tier === 2) return Number.POSITIVE_INFINITY;
  if (tier === 1) return 25;
  return 5;
}

function utcDayKey(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function endOfUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
}

/**
 * Enforces per-UTC-day usage limits by tier.
 * Returns RateLimitMeta on success (so UI can show remaining/reset).
 * Throws RATE_LIMIT error with meta when exceeded.
 */
export async function assertWithinDailyLimit(args: { req: Request; tier: Tier; clientId: string }) {
  const { tier, clientId } = args;

  const limit = tierLimit(tier);
  const reset = endOfUtcDay();

  // Unlimited: still return meta for UI, but no Redis usage
  if (!Number.isFinite(limit)) {
    const meta: RateLimitMeta = {
      tier,
      limit: -1,
      used: 0,
      remaining: -1,
      resetAt: reset.toISOString(),
      key: "unlimited",
      clientId,
    };
    return meta;
  }

  const day = utcDayKey();
  const key = `taxaipro:rl:${day}:${clientId}:t${tier}`;
  const redis = getRedis();

  // INCR returns the new count
  const used = await redis.incr(key);

  // Ensure the key expires at end of UTC day (reset window)
  const ttlSeconds = Math.max(60, Math.floor((reset.getTime() - Date.now()) / 1000));
  await redis.expire(key, ttlSeconds);

  const remaining = Math.max(0, limit - used);

  const meta: RateLimitMeta = {
    tier,
    limit,
    used,
    remaining,
    resetAt: reset.toISOString(),
    key,
    clientId,
  };

  if (used > limit) {
    const err: any = new Error("RATE_LIMIT");
    err.status = 429;
    err.meta = meta;
    throw err;
  }

  return meta;
}

export type { Tier, RateLimitMeta };
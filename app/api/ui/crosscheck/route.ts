// app/api/ui/crosscheck/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { requireSessionUser } from "../../../../src/lib/auth/session";
import {
  assertWithinDailyLimit,
  getClientId,
  getTierFromRequest,
  type RateLimitMeta,
} from "../../../../src/lib/usage/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function env(name: string): string {
  return process.env[name] || "";
}

function requireEnv(name: string) {
  const v = env(name);
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

type CrosscheckUiBody = {
  jurisdiction?: string;
  facts?: string;
  constraints?: string;
  question?: string;
  timeoutMs?: number;
  maxTokens?: number;
  // allow extra keys but we will ignore them
  [k: string]: unknown;
};

function sanitizeBody(raw: unknown): CrosscheckUiBody {
  const b: CrosscheckUiBody = raw && typeof raw === "object" ? (raw as any) : {};

  const jurisdiction = typeof b.jurisdiction === "string" ? b.jurisdiction.trim() : undefined;
  const facts = typeof b.facts === "string" ? b.facts : undefined;
  const constraints = typeof b.constraints === "string" ? b.constraints : undefined;
  const question = typeof b.question === "string" ? b.question.trim() : undefined;

  // clamp to sane bounds (avoid accidental huge values)
  const timeoutMs =
    typeof b.timeoutMs === "number" && Number.isFinite(b.timeoutMs)
      ? Math.max(1_000, Math.min(120_000, Math.floor(b.timeoutMs)))
      : undefined;

  const maxTokens =
    typeof b.maxTokens === "number" && Number.isFinite(b.maxTokens)
      ? Math.max(64, Math.min(8_192, Math.floor(b.maxTokens)))
      : undefined;

  // only forward known inputs
  return {
    jurisdiction: jurisdiction || undefined,
    facts: typeof facts === "string" ? facts : undefined,
    constraints: typeof constraints === "string" ? constraints : undefined,
    question: question || undefined,
    timeoutMs,
    maxTokens,
  };
}

function applyRateLimitHeaders(h: Headers, meta?: RateLimitMeta) {
  if (!meta) return;

  // Standard-ish pattern for client UX:
  // -1 means unlimited
  h.set("x-taxaipro-tier", String(meta.tier));
  h.set("x-ratelimit-limit", String(meta.limit));
  h.set("x-ratelimit-used", String(meta.used));
  h.set("x-ratelimit-remaining", String(meta.remaining));
  h.set("x-ratelimit-reset", meta.resetAt);
}

export async function POST(req: NextRequest) {
  let rlMeta: RateLimitMeta | undefined;

  try {
    // must be logged in to use the UI route
    await requireSessionUser();

    // ---- Rate limit (tier 0/1/2) ----
    // TEMP: tier comes from header x-taxaipro-tier (0|1|2), default 0.
    // Later: derive tier from user record (Stripe subscription).
    const tier = getTierFromRequest(req as unknown as Request);
    const clientId = getClientId(req as unknown as Request);

    rlMeta = await assertWithinDailyLimit({
      req: req as unknown as Request,
      tier,
      clientId,
    });

    const raw = await req.json().catch(() => ({}));
    const body = sanitizeBody(raw);

    if (!body.question) {
      const res = NextResponse.json({ ok: false, error: "Missing 'question'." }, { status: 400 });
      applyRateLimitHeaders(res.headers, rlMeta);
      res.headers.set("cache-control", "no-store, max-age=0");
      return res;
    }

    const key = requireEnv("CROSSCHECK_KEY");
    const url = new URL("/api/crosscheck", req.nextUrl.origin);

    const upstream = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-crosscheck-key": key,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await upstream.text();

    // Pass-through upstream body + status, but prevent caching.
    // Also attach rate-limit headers so the UI can show remaining/reset even on success.
    const res = new NextResponse(text, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json",
        "cache-control": "no-store, max-age=0",
      },
    });

    applyRateLimitHeaders(res.headers, rlMeta);
    return res;
  } catch (err: any) {
    const msg = err?.message || "Unknown error";

    if (msg === "UNAUTHORIZED") {
      const res = NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      applyRateLimitHeaders(res.headers, rlMeta);
      res.headers.set("cache-control", "no-store, max-age=0");
      return res;
    }

    // rate limit
    if (msg === "RATE_LIMIT") {
      const status = typeof err?.status === "number" ? err.status : 429;
      const meta = (err?.meta as RateLimitMeta | undefined) || rlMeta;

      const res = NextResponse.json(
        {
          ok: false,
          error: "Daily usage limit reached for your tier.",
          meta,
        },
        { status }
      );
      applyRateLimitHeaders(res.headers, meta);
      res.headers.set("cache-control", "no-store, max-age=0");
      return res;
    }

    if (msg.startsWith("Missing env var:")) {
      const res = NextResponse.json({ ok: false, error: msg }, { status: 500 });
      applyRateLimitHeaders(res.headers, rlMeta);
      res.headers.set("cache-control", "no-store, max-age=0");
      return res;
    }

    const res = NextResponse.json({ ok: false, error: msg }, { status: 500 });
    applyRateLimitHeaders(res.headers, rlMeta);
    res.headers.set("cache-control", "no-store, max-age=0");
    return res;
  }
}
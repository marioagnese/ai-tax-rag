// app/api/ui/crosscheck/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { requireSessionUser } from "../../../../src/lib/auth/session";
import {
  assertWithinDailyLimit,
  getClientId,
  getTierFromRequest,
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

export async function POST(req: NextRequest) {
  try {
    // must be logged in to use the UI route
    await requireSessionUser();

    // ---- Rate limit (tier 0/1/2) ----
    // TEMP: tier comes from header x-taxaipro-tier (0|1|2), default 0.
    // Later: derive tier from user record (Stripe subscription).
    const tier = getTierFromRequest(req as unknown as Request);
    const clientId = getClientId(req as unknown as Request);

    await assertWithinDailyLimit({
      req: req as unknown as Request,
      tier,
      clientId,
    });

    const raw = await req.json().catch(() => ({}));
    const body = sanitizeBody(raw);

    if (!body.question) {
      return NextResponse.json({ ok: false, error: "Missing 'question'." }, { status: 400 });
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

    // Pass-through upstream body + status, but prevent caching
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json",
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch (err: any) {
    const msg = err?.message || "Unknown error";

    if (msg === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // rate limit
    if (msg === "RATE_LIMIT") {
      const status = typeof err?.status === "number" ? err.status : 429;
      const meta = err?.meta || undefined;
      return NextResponse.json(
        {
          ok: false,
          error: "Daily usage limit reached for your tier.",
          meta,
        },
        { status }
      );
    }

    if (msg.startsWith("Missing env var:")) {
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }

    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
import { NextResponse, type NextRequest } from "next/server";
import { requireSessionUser } from "../../../../src/lib/auth/session";
import { resolveTierForUserEmail } from "../../../../src/lib/billing/resolveTier";
import { runCrosscheck } from "../../../../src/core/crosscheck/orchestrator";
import {
  assertWithinDailyLimit,
  getClientId,
  getTierFromRequest,
  type RateLimitMeta,
} from "../../../../src/lib/usage/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CrosscheckUiBody = {
  jurisdiction?: string;
  facts?: string;
  constraints?: string;
  question?: string;
  timeoutMs?: number;
  maxTokens?: number;
  runIntent?: "preliminary" | "followup" | "refine" | "finalize";
  [k: string]: unknown;
};

function sanitizeBody(raw: unknown): CrosscheckUiBody {
  const b: CrosscheckUiBody = raw && typeof raw === "object" ? (raw as any) : {};

  const jurisdiction =
    typeof b.jurisdiction === "string" ? b.jurisdiction.trim() : undefined;
  const facts = typeof b.facts === "string" ? b.facts : undefined;
  const constraints = typeof b.constraints === "string" ? b.constraints : undefined;
  const question =
    typeof b.question === "string" ? b.question.trim() : undefined;

  const rawRunIntent =
    typeof b.runIntent === "string" ? b.runIntent.trim().toLowerCase() : undefined;

  const runIntent =
    rawRunIntent === "preliminary" ||
    rawRunIntent === "followup" ||
    rawRunIntent === "refine" ||
    rawRunIntent === "finalize"
      ? rawRunIntent
      : undefined;

  const timeoutMs =
    typeof b.timeoutMs === "number" && Number.isFinite(b.timeoutMs)
      ? Math.max(1_000, Math.min(120_000, Math.floor(b.timeoutMs)))
      : undefined;

  const maxTokens =
    typeof b.maxTokens === "number" && Number.isFinite(b.maxTokens)
      ? Math.max(64, Math.min(8_192, Math.floor(b.maxTokens)))
      : undefined;

  return {
    jurisdiction: jurisdiction || undefined,
    facts: typeof facts === "string" ? facts : undefined,
    constraints: typeof constraints === "string" ? constraints : undefined,
    question: question || undefined,
    timeoutMs,
    maxTokens,
    runIntent,
  };
}

async function parseRequestBody(req: NextRequest): Promise<CrosscheckUiBody> {
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();

    const questionValue = form.get("question");
    const factsValue = form.get("facts");
    const constraintsValue = form.get("constraints");
    const jurisdictionValue = form.get("jurisdiction");
    const timeoutMsValue = form.get("timeoutMs");
    const maxTokensValue = form.get("maxTokens");
    const runIntentValue = form.get("runIntent");

    return sanitizeBody({
      question: typeof questionValue === "string" ? questionValue : undefined,
      facts: typeof factsValue === "string" ? factsValue : undefined,
      constraints: typeof constraintsValue === "string" ? constraintsValue : undefined,
      jurisdiction:
        typeof jurisdictionValue === "string" ? jurisdictionValue : undefined,
      timeoutMs:
        typeof timeoutMsValue === "string" && timeoutMsValue.trim()
          ? Number(timeoutMsValue)
          : undefined,
      maxTokens:
        typeof maxTokensValue === "string" && maxTokensValue.trim()
          ? Number(maxTokensValue)
          : undefined,
      runIntent: typeof runIntentValue === "string" ? runIntentValue : undefined,
    });
  }

  const raw = await req.json().catch(() => ({}));
  return sanitizeBody(raw);
}

function applyRateLimitHeaders(h: Headers, meta?: RateLimitMeta) {
  if (!meta) return;

  h.set("x-taxaipro-tier", String(meta.tier));
  h.set("x-ratelimit-limit", String(meta.limit));
  h.set("x-ratelimit-used", String(meta.used));
  h.set("x-ratelimit-remaining", String(meta.remaining));
  h.set("x-ratelimit-reset", meta.resetAt);
}

export async function POST(req: NextRequest) {
  let rlMeta: RateLimitMeta | undefined;

  try {
    const user = await requireSessionUser();

    const tier = Number(await resolveTierForUserEmail(user.email)) as 0 | 1 | 2;
    const clientId = getClientId(req as unknown as Request);

    rlMeta = await assertWithinDailyLimit({
      req: req as unknown as Request,
      tier,
      clientId,
    });

    const body = await parseRequestBody(req);

    if (!body.question) {
      const res = NextResponse.json(
        { ok: false, error: "Missing 'question'." },
        { status: 400 }
      );
      applyRateLimitHeaders(res.headers, rlMeta);
      res.headers.set("cache-control", "no-store, max-age=0");
      return res;
    }

    const result = await runCrosscheck({
      question: body.question,
      jurisdiction: body.jurisdiction,
      facts: body.facts,
      constraints: body.constraints,
      timeoutMs: body.timeoutMs,
      maxTokens: body.maxTokens,
      runIntent: body.runIntent,
    });

    const status = result.ok ? 200 : 502;

    const providerErrors = (result.providers || [])
      .map((p) => p.error)
      .filter(Boolean);

    const failureMessage =
      result.consensus?.answer ||
      providerErrors[0] ||
      "All providers failed.";

    const res = NextResponse.json(
      {
        ok: result.ok,
        meta: result.meta,
        consensus: result.consensus,
        providers: result.providers,
        error: result.ok ? undefined : failureMessage,
      },
      { status }
    );

    applyRateLimitHeaders(res.headers, rlMeta);
    res.headers.set("cache-control", "no-store, max-age=0");
    return res;
  } catch (err: any) {
    const msg = err?.message || "Unknown error";

    if (msg === "UNAUTHORIZED") {
      const res = NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
      applyRateLimitHeaders(res.headers, rlMeta);
      res.headers.set("cache-control", "no-store, max-age=0");
      return res;
    }

    if (msg === "RATE_LIMIT") {
      const status = typeof err?.status === "number" ? err.status : 429;
      const meta = (err?.meta as RateLimitMeta | undefined) || rlMeta;

      const res = NextResponse.json(
        { ok: false, error: "Daily usage limit reached for your tier.", meta },
        { status }
      );
      applyRateLimitHeaders(res.headers, meta);
      res.headers.set("cache-control", "no-store, max-age=0");
      return res;
    }

    const res = NextResponse.json(
      { ok: false, error: msg },
      { status: 500 }
    );
    applyRateLimitHeaders(res.headers, rlMeta);
    res.headers.set("cache-control", "no-store, max-age=0");
    return res;
  }
}
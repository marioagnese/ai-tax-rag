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

/* ---------------- Env helpers ---------------- */

function env(name: string): string {
  return process.env[name] || "";
}

function requireEnv(name: string) {
  const v = env(name);
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/* ---------------- Types ---------------- */

type CrosscheckUiBody = {
  jurisdiction?: string;
  facts?: string;
  constraints?: string;
  question?: string;
  timeoutMs?: number;
  maxTokens?: number;
  [k: string]: unknown;
};

type ProviderResult = {
  provider: string;
  model: string;
  status: "ok" | "error" | "timeout";
  ms: number;
  text?: string;
  error?: string;
};

type CrosscheckResponse = {
  ok: boolean;
  meta?: {
    attempted?: Array<{ provider: string; model: string }>;
    succeeded?: Array<{ provider: string; model: string }>;
    failed?: Array<{ provider: string; model: string }>;
    runtime_ms?: number;
  };
  consensus?: {
    answer?: string;
    caveats?: string[];
    followups?: string[];
    disagreements?: string[];
    confidence?: "low" | "medium" | "high";
  };
  providers?: ProviderResult[];
  error?: string;
};

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

/* ---------------- Sanitization ---------------- */

function sanitizeBody(raw: unknown): CrosscheckUiBody {
  const b: CrosscheckUiBody = raw && typeof raw === "object" ? (raw as any) : {};

  const jurisdiction = typeof b.jurisdiction === "string" ? b.jurisdiction.trim() : undefined;
  const facts = typeof b.facts === "string" ? b.facts : undefined;
  const constraints = typeof b.constraints === "string" ? b.constraints : undefined;
  const question = typeof b.question === "string" ? b.question.trim() : undefined;

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
  };
}

/* ---------------- Rate-limit headers ---------------- */

function applyRateLimitHeaders(h: Headers, meta?: RateLimitMeta) {
  if (!meta) return;

  h.set("x-taxaipro-tier", String(meta.tier));
  h.set("x-ratelimit-limit", String(meta.limit));
  h.set("x-ratelimit-used", String(meta.used));
  h.set("x-ratelimit-remaining", String(meta.remaining));
  h.set("x-ratelimit-reset", meta.resetAt);
}

/* ---------------- Provider calls (OpenAI-compatible) ---------------- */

async function callChatCompletions(args: {
  provider: string;
  baseURL: string;
  apiKey: string;
  model: string;
  messages: ChatMsg[];
  temperature: number;
  timeoutMs: number;
  maxTokens?: number;
}): Promise<ProviderResult> {
  const started = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), args.timeoutMs);

  try {
    const url = args.baseURL.replace(/\/+$/, "") + "/chat/completions";

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify({
        model: args.model,
        messages: args.messages,
        temperature: args.temperature,
        max_tokens: args.maxTokens,
      }),
      signal: ctrl.signal,
      cache: "no-store",
    });

    const ms = Date.now() - started;
    const text = await r.text();

    if (!r.ok) {
      return {
        provider: args.provider,
        model: args.model,
        status: "error",
        ms,
        error: `HTTP ${r.status}: ${text.slice(0, 500)}`,
      };
    }

    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    const content = String(json?.choices?.[0]?.message?.content ?? "").trim();

    if (!content) {
      return {
        provider: args.provider,
        model: args.model,
        status: "error",
        ms,
        error: "Empty response content.",
      };
    }

    return {
      provider: args.provider,
      model: args.model,
      status: "ok",
      ms,
      text: content,
    };
  } catch (e: any) {
    const ms = Date.now() - started;
    const aborted = e?.name === "AbortError";
    return {
      provider: args.provider,
      model: args.model,
      status: aborted ? "timeout" : "error",
      ms,
      error: aborted ? "Timed out" : (e?.message || "Request failed"),
    };
  } finally {
    clearTimeout(t);
  }
}

function buildMessages(body: CrosscheckUiBody): ChatMsg[] {
  const sysParts: string[] = [];
  if (body.constraints?.trim()) sysParts.push(body.constraints.trim());
  if (body.jurisdiction?.trim()) sysParts.push(`Jurisdiction: ${body.jurisdiction.trim()}`);
  if (body.facts?.trim()) sysParts.push(`Facts:\n${body.facts.trim()}`);

  const system = sysParts.length ? sysParts.join("\n\n") : "Be conservative. Avoid overclaiming.";
  const user = body.question?.trim() || "";

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function buildConsensus(providers: ProviderResult[]): CrosscheckResponse["consensus"] {
  const oks = providers.filter((p) => p.status === "ok" && p.text?.trim());
  const fails = providers.filter((p) => p.status !== "ok");

  if (!oks.length) {
    return {
      answer: "",
      caveats: [],
      followups: [],
      disagreements: [],
      confidence: "low",
    };
  }

  // Conservative baseline consensus:
  // Prefer OpenAI if present, else first successful.
  const openai = oks.find((p) => p.provider === "openai");
  const chosen = openai ?? oks[0];

  // Basic "disagreements" signal:
  const unique = Array.from(
    new Set(oks.map((p) => (p.text || "").slice(0, 240).replace(/\s+/g, " ").trim()))
  ).filter(Boolean);

  const disagreements =
    unique.length > 1
      ? unique.slice(0, 3).map((u, i) => `Model disagreement #${i + 1}: ${u}${u.length >= 240 ? "…" : ""}`)
      : [];

  const confidence: "low" | "medium" | "high" =
    oks.length >= 3 && fails.length === 0 ? "high" : oks.length >= 2 ? "medium" : "low";

  return {
    answer: chosen.text!,
    caveats: [],
    followups: [],
    disagreements,
    confidence,
  };
}

/* ---------------- Route ---------------- */

export async function POST(req: NextRequest) {
  let rlMeta: RateLimitMeta | undefined;

  try {
    // must be logged in to use the UI route
    await requireSessionUser();

    // ---- Rate limit (tier 0/1/2) ----
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

    const timeoutMs = body.timeoutMs ?? 35_000;
    const maxTokens = body.maxTokens ?? 1_200;
    const messages = buildMessages(body);

    // ---- Provider config ----
    // NOTE: change these models if you want. These are sane defaults.
    const providersToRun = [
      {
        provider: "openai",
        baseURL: "https://api.openai.com/v1",
        apiKey: requireEnv("OPENAI_API_KEY"),
        model: env("OPENAI_MODEL") || "gpt-4o-mini",
      },
      {
        provider: "perplexity",
        baseURL: env("PERPLEXITY_BASE_URL") || "https://api.perplexity.ai",
        apiKey: requireEnv("PERPLEXITY_API_KEY"),
        model: env("PERPLEXITY_MODEL") || "sonar-pro",
      },
      { 
        provider: "xai",
        baseURL: env("XAI_BASE_URL") || "https://api.x.ai/v1",
        apiKey: requireEnv("XAI_API_KEY"),
        model: env("XAI_MODEL") || "grok-4-latest",
      },
    ];

    const startedAll = Date.now();

    const settled = await Promise.allSettled(
      providersToRun.map((p) =>
        callChatCompletions({
          provider: p.provider,
          baseURL: p.baseURL,
          apiKey: p.apiKey,
          model: p.model,
          messages,
          temperature: 0.2,
          timeoutMs,
          maxTokens,
        })
      )
    );

    const results: ProviderResult[] = settled.map((s, i) => {
      if (s.status === "fulfilled") return s.value;
      return {
        provider: providersToRun[i].provider,
        model: providersToRun[i].model,
        status: "error",
        ms: Date.now() - startedAll,
        error: String((s.reason as any)?.message ?? s.reason ?? "error"),
      };
    });

    const attempted = providersToRun.map((p) => ({ provider: p.provider, model: p.model }));
    const succeeded = results
      .filter((r) => r.status === "ok")
      .map((r) => ({ provider: r.provider, model: r.model }));
    const failed = results
      .filter((r) => r.status !== "ok")
      .map((r) => ({ provider: r.provider, model: r.model }));

    const response: CrosscheckResponse = {
      ok: succeeded.length > 0,
      meta: {
        attempted,
        succeeded,
        failed,
        runtime_ms: Date.now() - startedAll,
      },
      consensus: buildConsensus(results),
      providers: results,
      error: succeeded.length > 0 ? undefined : "All providers failed.",
    };

    const status = response.ok ? 200 : 502;

    const res = NextResponse.json(response, { status });
    applyRateLimitHeaders(res.headers, rlMeta);
    res.headers.set("cache-control", "no-store, max-age=0");
    return res;
  } catch (err: any) {
    const msg = err?.message || "Unknown error";

    if (msg === "UNAUTHORIZED") {
      const res = NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
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
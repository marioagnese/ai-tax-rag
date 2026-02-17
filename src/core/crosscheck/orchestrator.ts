// src/core/crosscheck/orchestrator.ts
import type {
  CrosscheckInput,
  CrosscheckResult,
  ProviderCall,
  ProviderOutput,
} from "./types";
import { callOpenAI } from "./providers/openai";
import { callOpenRouter } from "./providers/openrouter";
import OpenAI from "openai";

function env(name: string): string {
  return process.env[name] || "";
}

function requireEnv(name: string) {
  const v = env(name);
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function uniq(xs: string[]) {
  return Array.from(new Set(xs.map((x) => String(x).trim()).filter(Boolean)));
}

function clampInt(n: unknown, min: number, max: number, fallback: number) {
  const v =
    typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : fallback;
  return Math.max(min, Math.min(max, v));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: any;
  const timeout = new Promise<T>((_, rej) => {
    t = setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms);
  });
  return Promise.race([p.finally(() => clearTimeout(t)), timeout]);
}

function defaultOpenRouterModels(): string[] {
  // Example: OPENROUTER_MODELS="anthropic/claude-3.5-sonnet,deepseek/deepseek-chat,x-ai/grok-4.1-fast"
  const raw = env("OPENROUTER_MODELS") || env("OPENROUTER_MODEL");
  const models = (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Keep a conservative, stable default
  return models.length ? models : ["anthropic/claude-3.5-sonnet"];
}

function pickBest(outputs: ProviderOutput[]): ProviderOutput | null {
  const ok = outputs.filter(
    (o) => o.status === "ok" && (o.text || "").trim().length > 50
  );
  if (!ok.length) return null;

  // crude scoring: longer + fewer obvious refusal/error words
  const scored = ok.map((o) => {
    const text = (o.text || "").toLowerCase();
    const bad = ["i don't know", "cannot", "unable", "no information"].some((k) =>
      text.includes(k)
    )
      ? 1
      : 0;
    const len = (o.text || "").length;
    const score = len - bad * 400;
    return { o, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].o;
}

function safeJsonParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/**
 * Many models wrap JSON in ```json ... ``` fences. Strip those safely.
 */
function extractJsonObject(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "{}";

  // fenced block
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence?.[1]) return fence[1].trim();

  // try to pull the first {...} block
  const firstBrace = s.indexOf("{");
  const lastBrace = s.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return s.slice(firstBrace, lastBrace + 1).trim();
  }

  return s;
}

function normalizeConsensus(parsed: any) {
  const answer = String(parsed?.answer || "").trim();

  const caveats = Array.isArray(parsed?.caveats)
    ? parsed.caveats.map(String)
    : [];
  const followups = Array.isArray(parsed?.followups)
    ? parsed.followups.map(String)
    : [];
  const disagreements = Array.isArray(parsed?.disagreements)
    ? parsed.disagreements.map(String)
    : [];

  const confidenceRaw = String(parsed?.confidence || "").toLowerCase();
  const confidence =
    confidenceRaw === "high" || confidenceRaw === "medium" || confidenceRaw === "low"
      ? (confidenceRaw as "low" | "medium" | "high")
      : "low";

  return {
    answer,
    caveats: uniq(caveats),
    followups: uniq(followups),
    disagreements: uniq(disagreements),
    confidence,
  };
}

function summarizeProviderForMeta(p: ProviderOutput): ProviderCall {
  return { provider: p.provider, model: p.model };
}

function classifyProviderError(e: any): { status: "timeout" | "error"; error: string } {
  const msg = e?.message ? String(e.message) : String(e);
  const status = msg.toLowerCase().includes("timeout") ? "timeout" : "error";
  return { status, error: msg };
}

async function synthesizeWithOpenAI(
  input: CrosscheckInput,
  outputs: ProviderOutput[]
) {
  // If no OpenAI key, degrade gracefully: synthesize from best provider.
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) {
    const best = pickBest(outputs);
    return normalizeConsensus({
      answer: best?.text || "",
      caveats: best?.text
        ? [
            "Synthesis model unavailable (missing OPENAI_API_KEY). Returned best single-provider output.",
          ]
        : [
            "Synthesis model unavailable (missing OPENAI_API_KEY). No successful provider output.",
          ],
      followups: [],
      disagreements: [],
      confidence: "low",
    });
  }

  const model =
    env("OPENAI_SYNTH_MODEL") || env("OPENAI_MODEL") || "gpt-4.1-mini";
  const client = new OpenAI({ apiKey });

  const packed = outputs
    .map((o) => {
      const head = `=== PROVIDER ${o.provider} (${o.model}) status=${o.status} ===`;
      const body = (o.text || o.error || "").slice(0, 12000);
      return `${head}\n${body}`;
    })
    .join("\n\n");

  const sys = [
    "You are the Crosscheck Orchestrator for a tax AI product.",
    "Your job: synthesize a conservative consensus answer from multiple model outputs.",
    "Do NOT invent citations. If you reference an authority, name it only if it was mentioned by providers or is truly standard/common doctrine.",
    "Be explicit about assumptions, caveats, and missing facts needed to confirm.",
    "If providers disagree, summarize the disagreement in plain language.",
    "Return STRICT JSON ONLY with keys: answer, caveats, followups, disagreements, confidence.",
    "caveats/followups/disagreements must be arrays of strings. confidence must be one of: low, medium, high.",
  ].join("\n");

  const user = [
    input.jurisdiction ? `Jurisdiction: ${input.jurisdiction}` : "",
    input.constraints ? `Constraints: ${input.constraints}` : "",
    input.facts ? `Facts:\n${input.facts}` : "",
    `Question:\n${input.question}`,
    "",
    "Provider outputs:",
    packed,
  ]
    .filter(Boolean)
    .join("\n\n");

  // Keep synth reasonably bounded
  const max_tokens = clampInt((input as any)?.maxTokens, 256, 1200, 900);

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    max_tokens,
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";
  const extracted = extractJsonObject(raw);
  const parsed = safeJsonParse<any>(extracted);

  if (!parsed) {
    // fallback: keep raw in answer
    return normalizeConsensus({
      answer: raw,
      caveats: ["Synthesis did not return valid JSON; returning raw output."],
      followups: [],
      disagreements: [],
      confidence: "low",
    });
  }

  return normalizeConsensus(parsed);
}

export async function runCrosscheck(
  input: CrosscheckInput
): Promise<CrosscheckResult> {
  const t0 = Date.now();

  const timeoutMs = clampInt(input.timeoutMs, 8_000, 120_000, 45_000);

  const attempted: ProviderCall[] = [];
  const tasks: Array<Promise<ProviderOutput>> = [];

  // We need to preserve provider/model labeling even when a task errors.
  // Wrap each call so we always return a ProviderOutput tagged correctly.
  const wrap = (
    call: ProviderCall,
    fn: () => Promise<ProviderOutput>
  ): Promise<ProviderOutput> => {
    attempted.push(call);
    return withTimeout(fn(), timeoutMs).catch((e: any) => {
      const { status, error } = classifyProviderError(e);
      return {
        provider: call.provider,
        model: call.model,
        status,
        ms: timeoutMs,
        error,
      } satisfies ProviderOutput;
    });
  };

  // OpenAI provider call (if configured, callOpenAI should handle missing key gracefully,
  // but we still attempt so meta shows it)
  const openaiModel = env("OPENAI_MODEL") || "gpt-4.1-mini";
  tasks.push(
    wrap({ provider: "openai", model: openaiModel }, () => callOpenAI(input))
  );

  // NOTE: Gemini disabled for now to stabilize deployment.
  // Re-enable later behind a GEMINI_ENABLED flag once provider is stable.

  // OpenRouter fan-out
  for (const m of defaultOpenRouterModels()) {
    tasks.push(
      wrap({ provider: "openrouter", model: m }, () => callOpenRouter(input, m))
    );
  }

  const providers = await Promise.all(tasks);

  const succeededCalls: ProviderCall[] = [];
  const failedCalls: ProviderCall[] = [];
  for (const p of providers) {
    const call = summarizeProviderForMeta(p);
    if (p.status === "ok") succeededCalls.push(call);
    else failedCalls.push(call);
  }

  const synth = await synthesizeWithOpenAI(input, providers);

  // Degrade gracefully if synth came back empty
  const best = pickBest(providers);
  const answer =
    synth.answer ||
    (best?.text?.trim() ||
      `I couldn't get a successful provider response yet. Providers attempted: ${attempted
        .map((a) => `${a.provider}:${a.model}`)
        .join(", ")}`);

  const caveats = uniq([
    ...synth.caveats,
    ...(!succeededCalls.length
      ? [
          "No providers returned a successful answer. Check API keys, model names, and network access.",
        ]
      : []),
  ]);

  const followups = uniq(synth.followups);
  const disagreements = uniq(synth.disagreements);

  const runtime_ms = Date.now() - t0;

  return {
    ok: !!succeededCalls.length,
    meta: {
      attempted,
      succeeded: succeededCalls,
      failed: failedCalls,
      runtime_ms,
    },
    consensus: {
      answer,
      caveats,
      followups,
      confidence: synth.confidence,
      disagreements,
    },
    providers,
  };
}

import type { CrosscheckInput, CrosscheckResult, ProviderCall, ProviderOutput } from "./types";
import { callOpenAI } from "./providers/openai";
import { callOpenRouter } from "./providers/openrouter";
import { callGemini } from "./providers/gemini";
import OpenAI from "openai";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function uniq(xs: string[]) {
  return Array.from(new Set(xs.map(x => x.trim()).filter(Boolean)));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: any;
  const timeout = new Promise<T>((_, rej) => {
    t = setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms);
  });
  return Promise.race([p.finally(() => clearTimeout(t)), timeout]);
}

function defaultOpenRouterModels(): string[] {
  // put Claude/DeepSeek/Grok through OpenRouter by listing models here
  // Example: OPENROUTER_MODELS="anthropic/claude-3.5-sonnet,deepseek/deepseek-chat,x-ai/grok-2"
  const raw = process.env.OPENROUTER_MODELS || process.env.OPENROUTER_MODEL || "";
  const models = raw.split(",").map(s => s.trim()).filter(Boolean);
  return models.length ? models : ["anthropic/claude-3.5-sonnet"];
}

function pickBest(outputs: ProviderOutput[]): ProviderOutput | null {
  const ok = outputs.filter(o => o.status === "ok" && (o.text || "").trim().length > 50);
  if (!ok.length) return null;

  // crude scoring: longer + fewer obvious error words
  const scored = ok.map(o => {
    const text = (o.text || "").toLowerCase();
    const bad = ["i don't know", "cannot", "unable", "no information"].some(k => text.includes(k)) ? 1 : 0;
    const len = (o.text || "").length;
    const score = len - bad * 400;
    return { o, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].o;
}

async function synthesizeWithOpenAI(input: CrosscheckInput, outputs: ProviderOutput[]) {
  const apiKey = requireEnv("OPENAI_API_KEY");
  const model = process.env.OPENAI_SYNTH_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const client = new OpenAI({ apiKey });

  const packed = outputs.map(o => {
    const head = `=== PROVIDER ${o.provider} (${o.model}) status=${o.status} ===`;
    const body = (o.text || o.error || "").slice(0, 12000);
    return `${head}\n${body}`;
  }).join("\n\n");

  const sys = [
    "You are the Crosscheck Orchestrator for a tax AI product.",
    "You must: (1) extract consensus, (2) flag contradictions, (3) list missing facts needed, (4) provide a conservative best answer.",
    "Do NOT invent citations. If you reference an authority, name it only if it was mentioned by providers or is truly standard/common (e.g., 'Panama territorial taxation' as a concept).",
    "Write clearly, like a tax partner doing a rapid triage email.",
    "Return strict JSON with keys: answer, caveats, followups, disagreements, confidence."
  ].join("\n");

  const user = [
    input.jurisdiction ? `Jurisdiction: ${input.jurisdiction}` : "",
    input.constraints ? `Constraints: ${input.constraints}` : "",
    input.facts ? `Facts:\n${input.facts}` : "",
    `Question:\n${input.question}`,
    "",
    "Provider outputs:",
    packed
  ].filter(Boolean).join("\n\n");

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user }
    ],
    max_tokens: 900
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";

  // best-effort JSON parse
  let parsed: any = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    // fallback: keep raw in answer
    parsed = {
      answer: raw,
      caveats: [],
      followups: [],
      disagreements: [],
      confidence: "low"
    };
  }

  return {
    answer: String(parsed.answer || "").trim(),
    caveats: Array.isArray(parsed.caveats) ? parsed.caveats.map(String) : [],
    followups: Array.isArray(parsed.followups) ? parsed.followups.map(String) : [],
    disagreements: Array.isArray(parsed.disagreements) ? parsed.disagreements.map(String) : [],
    confidence: (["low", "medium", "high"].includes(parsed.confidence) ? parsed.confidence : "low") as "low"|"medium"|"high"
  };
}

export async function runCrosscheck(input: CrosscheckInput): Promise<CrosscheckResult> {
  const t0 = Date.now();
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 45000, 8000), 120000);

  const attempted: ProviderCall[] = [];
  const tasks: Promise<ProviderOutput>[] = [];

  // OpenAI
  attempted.push({ provider: "openai", model: process.env.OPENAI_MODEL || "gpt-4.1-mini" });
  tasks.push(withTimeout(callOpenAI(input), timeoutMs));

  // Gemini
  attempted.push({ provider: "gemini", model: process.env.GEMINI_MODEL || "gemini-1.5-pro" });
  tasks.push(withTimeout(callGemini(input), timeoutMs));

  // OpenRouter fan-out
  for (const m of defaultOpenRouterModels()) {
    attempted.push({ provider: "openrouter", model: m });
    tasks.push(withTimeout(callOpenRouter(input, m), timeoutMs));
  }

  const providers = await Promise.all(tasks.map(p => p.catch((e: any) => {
    const msg = e?.message || String(e);
    // we don't know which provider it was here, so tag as openrouter generic if message mentions it; else unknown.
    return {
      provider: "openrouter",
      model: "unknown",
      status: (msg.includes("timeout") ? "timeout" : "error") as any,
      ms: timeoutMs,
      error: msg
    } satisfies ProviderOutput;
  })));

  const succeededCalls: ProviderCall[] = [];
  const failedCalls: ProviderCall[] = [];
  for (const p of providers) {
    const call: ProviderCall = { provider: p.provider, model: p.model };
    if (p.status === "ok") succeededCalls.push(call);
    else failedCalls.push(call);
  }

  const best = pickBest(providers);
  const synth = await synthesizeWithOpenAI(input, providers);

  // If synth came back empty, degrade gracefully
  const answer = synth.answer || (best?.text?.trim() || `I couldn't get a successful provider response yet. Providers attempted: ${attempted.map(a => `${a.provider}:${a.model}`).join(", ")}`);

  const caveats = uniq([
    ...synth.caveats,
    ...(!succeededCalls.length ? ["No providers returned a successful answer. Check API keys, model names, and network access."] : [])
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
      runtime_ms
    },
    consensus: {
      answer,
      caveats,
      followups,
      confidence: synth.confidence,
      disagreements
    },
    providers
  };
}

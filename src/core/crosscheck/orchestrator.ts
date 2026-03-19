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
  const raw = env("OPENROUTER_MODELS") || env("OPENROUTER_MODEL");
  const models = (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return models.length ? models : ["anthropic/claude-3.5-sonnet"];
}

function pickBest(outputs: ProviderOutput[]): ProviderOutput | null {
  const ok = outputs.filter(
    (o) => o.status === "ok" && (o.text || "").trim().length > 50
  );
  if (!ok.length) return null;

  const scored = ok.map((o) => {
    const text = (o.text || "").toLowerCase();

    const refusalPenalty = ["i don't know", "cannot", "unable", "no information"].some((k) =>
      text.includes(k)
    )
      ? 1
      : 0;

    const weakLanguagePenalty = ["may vary", "depends", "consult a professional"].filter((k) =>
      text.includes(k)
    ).length;

    const usefulSignals =
      [
        "however",
        "but",
        "title",
        "risk",
        "depends on contract",
        "missing facts",
        "caveat",
        "assumption",
      ].filter((k) => text.includes(k)).length * 80;

    const len = (o.text || "").length;
    const score = len + usefulSignals - refusalPenalty * 500 - weakLanguagePenalty * 80;

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

function extractJsonObject(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "{}";

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence?.[1]) return fence[1].trim();

  const firstBrace = s.indexOf("{");
  const lastBrace = s.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return s.slice(firstBrace, lastBrace + 1).trim();
  }

  return s;
}

type SynthJson = {
  bottom_line?: string;
  common_ground?: string[];
  material_nuances?: string[];
  differences_in_emphasis?: string[];
  conservative_recommendation?: string;
  missing_facts?: string[];
  caveats?: string[];
  disagreements?: string[];
  confidence?: "low" | "medium" | "high" | string;
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniq(value.map(String));
}

function buildStructuredAnswer(parsed: SynthJson): string {
  const bottomLine = String(parsed?.bottom_line || "").trim();
  const commonGround = normalizeStringArray(parsed?.common_ground);
  const materialNuances = normalizeStringArray(parsed?.material_nuances);
  const differences = normalizeStringArray(parsed?.differences_in_emphasis);
  const recommendation = String(parsed?.conservative_recommendation || "").trim();
  const missingFacts = normalizeStringArray(parsed?.missing_facts);

  const lines: string[] = [];

  if (bottomLine) {
    lines.push(bottomLine);
  }

  if (commonGround.length) {
    lines.push("");
    lines.push("Common ground:");
    commonGround.forEach((x) => lines.push(`- ${x}`));
  }

  if (materialNuances.length) {
    lines.push("");
    lines.push("Material nuances:");
    materialNuances.forEach((x) => lines.push(`- ${x}`));
  }

  if (differences.length) {
    lines.push("");
    lines.push("Differences in emphasis:");
    differences.forEach((x) => lines.push(`- ${x}`));
  }

  if (recommendation) {
    lines.push("");
    lines.push("Conservative recommendation:");
    lines.push(recommendation);
  }

  if (missingFacts.length) {
    lines.push("");
    lines.push("Missing facts / follow-ups needed:");
    missingFacts.forEach((x) => lines.push(`- ${x}`));
  }

  return lines.join("\n").trim();
}

function normalizeConsensus(parsed: any) {
  const caveats = normalizeStringArray(parsed?.caveats);
  const followups = normalizeStringArray(parsed?.missing_facts ?? parsed?.followups);
  const differences = normalizeStringArray(parsed?.differences_in_emphasis);
  const disagreementsRaw = normalizeStringArray(parsed?.disagreements);
  const materialNuances = normalizeStringArray(parsed?.material_nuances);

  const confidenceRaw = String(parsed?.confidence || "").toLowerCase();
  const confidence =
    confidenceRaw === "high" || confidenceRaw === "medium" || confidenceRaw === "low"
      ? (confidenceRaw as "low" | "medium" | "high")
      : "low";

  const answer =
    buildStructuredAnswer(parsed) ||
    String(parsed?.answer || "").trim();

  const disagreements = uniq([
    ...differences,
    ...disagreementsRaw,
    ...materialNuances.filter((x) => /^minority view:/i.test(x) || /^one model/i.test(x)),
  ]);

  return {
    answer,
    caveats,
    followups,
    disagreements,
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

function packProviderOutputs(outputs: ProviderOutput[]): string {
  return outputs
    .map((o) => {
      const head = `=== PROVIDER ${o.provider} (${o.model}) status=${o.status} ===`;
      const body = (o.text || o.error || "").slice(0, 12000);
      return `${head}\n${body}`;
    })
    .join("\n\n");
}

async function synthesizeWithOpenAI(
  input: CrosscheckInput,
  outputs: ProviderOutput[]
) {
  const apiKey = env("OPENAI_API_KEY");

  if (!apiKey) {
    const best = pickBest(outputs);
    return normalizeConsensus({
      bottom_line: best?.text || "",
      common_ground: [],
      material_nuances: [
        "Synthesis model unavailable (missing OPENAI_API_KEY). Returned best single-provider output only.",
      ],
      differences_in_emphasis: [],
      conservative_recommendation: "",
      missing_facts: [],
      caveats: best?.text
        ? ["Synthesis model unavailable; this is not a true adjudicated consensus."]
        : ["Synthesis model unavailable and no successful provider output was available."],
      disagreements: [],
      confidence: "low",
    });
  }

  const model =
    env("OPENAI_SYNTH_MODEL") || env("OPENAI_MODEL") || "gpt-4.1-mini";
  const client = new OpenAI({ apiKey });

  const packed = packProviderOutputs(outputs);

  const sys = [
    "You are the Crosscheck Orchestrator for a tax analysis platform.",
    "Your role is NOT to produce a generic summary.",
    "Your role is to adjudicate multiple model answers like a conservative senior tax professional.",
    "",
    "Decision rules:",
    "1. Distinguish common ground from legally material nuance.",
    "2. If only one or two models raise an important legal distinction, do NOT discard it merely because it is a minority view.",
    "3. A narrower but more legally precise distinction can outweigh broader generic consensus.",
    "4. Treat differences in emphasis as meaningful, even if there is no direct contradiction.",
    "5. Prioritize legal precision, assumptions, contract-dependence, and missing facts over fluency.",
    "6. Do not invent authority or citations.",
    "7. Be conservative and explicit about uncertainty.",
    "",
    "Return STRICT JSON ONLY with these exact keys:",
    "{",
    '  "bottom_line": string,',
    '  "common_ground": string[],',
    '  "material_nuances": string[],',
    '  "differences_in_emphasis": string[],',
    '  "conservative_recommendation": string,',
    '  "missing_facts": string[],',
    '  "caveats": string[],',
    '  "disagreements": string[],',
    '  "confidence": "low" | "medium" | "high"',
    "}",
    "",
    "Important:",
    "- 'material_nuances' should include minority-but-important legal distinctions.",
    "- 'differences_in_emphasis' should capture meaningful differences even without direct contradiction.",
    "- 'disagreements' should be reserved for actual competing conclusions or materially different legal framing.",
    "- 'bottom_line' must be concise and conservative.",
    "- 'conservative_recommendation' should tell the user what to do next before relying on the conclusion.",
  ].join("\n");

  const user = [
    input.jurisdiction ? `Jurisdiction: ${input.jurisdiction}` : "",
    input.constraints ? `Constraints: ${input.constraints}` : "",
    input.facts ? `Facts:\n${input.facts}` : "",
    `Question:\n${input.question}`,
    "",
    "Provider outputs to adjudicate:",
    packed,
  ]
    .filter(Boolean)
    .join("\n\n");

  const max_tokens = clampInt((input as any)?.maxTokens, 400, 1800, 1200);

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
  const parsed = safeJsonParse<SynthJson>(extracted);

  if (!parsed) {
    return normalizeConsensus({
      bottom_line: raw,
      common_ground: [],
      material_nuances: ["Synthesis did not return valid JSON; raw synthesis output returned."],
      differences_in_emphasis: [],
      conservative_recommendation: "",
      missing_facts: [],
      caveats: ["Synthesis output format was invalid."],
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

  const openaiModel = env("OPENAI_MODEL") || "gpt-4.1-mini";
  tasks.push(
    wrap({ provider: "openai", model: openaiModel }, () => callOpenAI(input))
  );

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
    ...(succeededCalls.length === 1
      ? [
          "Only one provider returned a successful answer, so the result is weaker than a true cross-model adjudication.",
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
import type {
  CrosscheckInput,
  CrosscheckResult,
  ProviderCall,
  ProviderOutput,
} from "./types";
import { callOpenAI } from "./providers/openai";
import { callOpenRouter } from "./providers/openrouter";
import { callGemini } from "./providers/gemini";
import { callAnthropic } from "./providers/anthropic";
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

function dualAdjudicatorEnabled(): boolean {
  const raw = (env("CROSSCHECK_DUAL_ADJUDICATOR") || "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off";
}

function geminiEnabled(): boolean {
  return (env("GEMINI_ENABLED") || "").trim().toLowerCase() === "true";
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
        "diferencial",
        "difal",
        "substituição tributária",
        "final consumer",
        "fixed assets",
        "consumption",
        "resale",
        "industrialization",
        "constitutional",
        "complementary law",
      ].filter((k) => text.includes(k)).length * 80;

    const overgeneralizationPenalty =
      [
        "typically",
        "generally",
        "usually",
      ].filter((k) => text.includes(k)).length * 35;

    const len = (o.text || "").length;
    const score =
      len +
      usefulSignals -
      refusalPenalty * 500 -
      weakLanguagePenalty * 80 -
      overgeneralizationPenalty;

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

type AdjudicationJson = {
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

function buildStructuredAnswer(parsed: AdjudicationJson): string {
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
    lines.push("Material legal distinctions:");
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

  const answer = buildStructuredAnswer(parsed) || String(parsed?.answer || "").trim();

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

function buildAdjudicationSystemPrompt(label: "GPT" | "CLAUDE") {
  return [
    `You are ${label}, acting as a tax adjudicator inside a multi-model tax analysis platform.`,
    "Your role is NOT to produce a generic summary.",
    "Your role is to adjudicate multiple model answers like a conservative senior tax professional.",
    "",
    "Core principle:",
    "A legally significant distinction can control the answer even if only one model raised it.",
    "",
    "Decision rules:",
    "1. Distinguish broad common ground from controlling legal distinctions.",
    "2. If only one or two models raise an important legal distinction, do NOT discard it merely because it is a minority view.",
    "3. A narrower but more legally precise distinction can outweigh broader generic consensus.",
    "4. Treat differences in emphasis as meaningful, even if there is no direct contradiction.",
    "5. Prioritize legal precision, taxpayer status, transaction purpose, destination/origin mechanics, and missing facts over fluency.",
    "6. Penalize answers that sound smooth but collapse multiple legal regimes into one simplified statement.",
    "7. If a statement is only true for one transaction profile (for example B2C but not all B2B), do not state it as a general rule.",
    "8. If a constitutional rule, statutory framework, or transaction-classification distinction appears, elevate it above generic summary language.",
    "9. Do not invent authority or citations.",
    "10. Be conservative and explicit about uncertainty.",
    "",
    "When relevant, separate these transaction categories instead of blending them:",
    "- B2B for resale / industrialization",
    "- B2B for own use, consumption, or fixed assets",
    "- B2C / final consumer",
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
    "Important output rules:",
    "- 'common_ground' = high-level points most models share.",
    "- 'material_nuances' = legally significant distinctions, including minority-but-important points.",
    "- 'differences_in_emphasis' = meaningful differences that do not necessarily create conflicting conclusions.",
    "- 'disagreements' = actual competing legal conclusions or materially different legal framing.",
    "- 'bottom_line' must be concise, conservative, and not over-generalized.",
    "- 'conservative_recommendation' should say what must be verified before relying on the answer.",
    "- If a so-called nuance is actually outcome-determinative, still place it in 'material_nuances' and phrase it as controlling.",
  ].join("\n");
}

async function adjudicateWithOpenAI(
  input: CrosscheckInput,
  outputs: ProviderOutput[]
) {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) return null;

  const model =
    env("OPENAI_ADJUDICATOR_MODEL") ||
    env("OPENAI_SYNTH_MODEL") ||
    env("OPENAI_MODEL") ||
    "gpt-4.1-mini";

  const client = new OpenAI({ apiKey });
  const packed = packProviderOutputs(outputs);

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

  const max_tokens = clampInt((input as any)?.maxTokens, 500, 2000, 1400);

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      { role: "system", content: buildAdjudicationSystemPrompt("GPT") },
      { role: "user", content: user },
    ],
    max_tokens,
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";
  const extracted = extractJsonObject(raw);
  const parsed = safeJsonParse<AdjudicationJson>(extracted);

  if (!parsed) return null;
  return normalizeConsensus(parsed);
}

async function adjudicateWithClaude(
  input: CrosscheckInput,
  outputs: ProviderOutput[]
) {
  const packed = packProviderOutputs(outputs);

  const prompt = [
    input.jurisdiction ? `Jurisdiction: ${input.jurisdiction}` : "",
    input.constraints ? `Constraints: ${input.constraints}` : "",
    input.facts ? `Facts:\n${input.facts}` : "",
    `Question:\n${input.question}`,
    "",
    "Provider outputs to adjudicate:",
    packed,
    "",
    buildAdjudicationSystemPrompt("CLAUDE"),
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await callAnthropic({
    ...input,
    question: prompt,
    maxTokens: clampInt((input as any)?.maxTokens, 500, 3000, 1600),
  });

  if (result.status !== "ok" || !result.text) return null;

  const extracted = extractJsonObject(result.text);
  const parsed = safeJsonParse<AdjudicationJson>(extracted);

  if (!parsed) return null;
  return normalizeConsensus(parsed);
}

async function mergeAdjudicationsWithOpenAI(args: {
  input: CrosscheckInput;
  providerOutputs: ProviderOutput[];
  gpt: ReturnType<typeof normalizeConsensus> | null;
  claude: ReturnType<typeof normalizeConsensus> | null;
}) {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) return args.gpt || args.claude || null;

  const model =
    env("OPENAI_MERGER_MODEL") ||
    env("OPENAI_ADJUDICATOR_MODEL") ||
    env("OPENAI_SYNTH_MODEL") ||
    env("OPENAI_MODEL") ||
    "gpt-4.1-mini";

  const client = new OpenAI({ apiKey });

  const packedProviders = packProviderOutputs(args.providerOutputs);

  const gptJson = JSON.stringify(args.gpt || {}, null, 2);
  const claudeJson = JSON.stringify(args.claude || {}, null, 2);

  const sys = [
    "You are the final merger model for a tax adjudication engine.",
    "You are receiving:",
    "1. raw provider outputs,",
    "2. a GPT adjudication, and",
    "3. a Claude adjudication.",
    "",
    "Your job is to produce the safest, most conservative merged answer.",
    "Do NOT average them blindly.",
    "Do NOT prefer the smoother or more general answer merely because it sounds cleaner.",
    "If one adjudicator captures a more precise legal distinction, keep it.",
    "If one adjudicator separates transaction categories correctly and the other blends them, prefer the separated analysis.",
    "If a minority view introduces a constitutional, statutory, or classification-based distinction, treat it as potentially controlling.",
    "Broad consensus does not override a narrower legally correct distinction.",
    "Distinguish common ground, material nuances, differences in emphasis, and true disagreements.",
    "Do not invent authority or citations.",
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
    "- Do not overstate general rules when they only apply to specific transaction types.",
    "- Prefer legal precision over brevity.",
    "- If needed, narrow the bottom line rather than making it over-broad.",
  ].join("\n");

  const user = [
    args.input.jurisdiction ? `Jurisdiction: ${args.input.jurisdiction}` : "",
    args.input.constraints ? `Constraints: ${args.input.constraints}` : "",
    args.input.facts ? `Facts:\n${args.input.facts}` : "",
    `Question:\n${args.input.question}`,
    "",
    "Raw provider outputs:",
    packedProviders,
    "",
    "GPT adjudication:",
    gptJson,
    "",
    "Claude adjudication:",
    claudeJson,
  ]
    .filter(Boolean)
    .join("\n\n");

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    max_tokens: 1600,
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";
  const extracted = extractJsonObject(raw);
  const parsed = safeJsonParse<AdjudicationJson>(extracted);

  if (!parsed) return args.gpt || args.claude || null;
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

  if (geminiEnabled()) {
    const geminiModel = env("GEMINI_MODEL") || "gemini-2.5-flash";
    tasks.push(
      wrap({ provider: "gemini", model: geminiModel }, () => callGemini(input))
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

  const best = pickBest(providers);

  let finalConsensus: ReturnType<typeof normalizeConsensus> | null = null;

  if (dualAdjudicatorEnabled()) {
    const [gptAdj, claudeAdj] = await Promise.all([
      adjudicateWithOpenAI(input, providers).catch(() => null),
      adjudicateWithClaude(input, providers).catch(() => null),
    ]);

    finalConsensus = await mergeAdjudicationsWithOpenAI({
      input,
      providerOutputs: providers,
      gpt: gptAdj,
      claude: claudeAdj,
    }).catch(() => gptAdj || claudeAdj || null);
  } else {
    finalConsensus = await adjudicateWithOpenAI(input, providers).catch(() => null);
  }

  const answer =
    finalConsensus?.answer ||
    (best?.text?.trim() ||
      `I couldn't get a successful provider response yet. Providers attempted: ${attempted
        .map((a) => `${a.provider}:${a.model}`)
        .join(", ")}`);

  const caveats = uniq([
    ...(finalConsensus?.caveats || []),
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

  const followups = uniq(finalConsensus?.followups || []);
  const disagreements = uniq(finalConsensus?.disagreements || []);

  const confidence =
    finalConsensus?.confidence ||
    (succeededCalls.length >= 2 ? "medium" : "low");

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
      confidence,
      disagreements,
    },
    providers,
  };
}
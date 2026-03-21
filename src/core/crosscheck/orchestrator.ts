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
      ["typically", "generally", "usually"].filter((k) => text.includes(k)).length * 35;

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

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniq(value.map(String));
}

function normalizeText(s: string): string {
  return String(s || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(s: string, max = 700): string {
  const v = String(s || "").trim();
  if (v.length <= max) return v;
  return `${v.slice(0, max - 3).trim()}...`;
}

function splitIntoSnippets(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const bulletized = normalized
    .replace(/\n[-*]\s+/g, "\n")
    .replace(/\n\d+\.\s+/g, "\n");

  const parts = bulletized
    .split(/\n+|(?<=[.!?;:])\s+(?=[A-Z0-9(])/g)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x.length >= 20);

  return uniq(parts);
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

type IssueDefinition = {
  id: string;
  label: string;
  description: string;
  keywords: string[];
  priority: number;
  alwaysInclude?: boolean;
};

type IssueNode = {
  issueId: string;
  issueLabel: string;
  provider: string;
  model: string;
  status: ProviderOutput["status"];
  snippets: string[];
  synthesized: string;
};

type IssueMatrix = {
  issues: IssueDefinition[];
  nodes: Record<string, IssueNode[]>;
};

type IssueResultJson = {
  issue_id?: string;
  issue_label?: string;
  selected_provider?: string;
  selected_model?: string;
  conclusion?: string;
  reasoning?: string;
  minority_view?: string;
  controlling?: boolean;
  confidence?: "low" | "medium" | "high" | string;
  missing_facts?: string[];
};

type IssueAdjudicationJson = {
  bottom_line?: string;
  transaction_branches?: string[];
  issue_results?: IssueResultJson[];
  cross_issue_warnings?: string[];
  conservative_recommendation?: string;
  missing_facts?: string[];
  caveats?: string[];
  disagreements?: string[];
  confidence?: "low" | "medium" | "high" | string;
};

type NormalizedIssueResult = {
  issue_id: string;
  issue_label: string;
  selected_provider: string;
  selected_model: string;
  conclusion: string;
  reasoning: string;
  minority_view?: string;
  controlling: boolean;
  confidence: "low" | "medium" | "high";
  missing_facts: string[];
};

type NormalizedIssueConsensus = {
  answer: string;
  transaction_branches: string[];
  issue_results: NormalizedIssueResult[];
  cross_issue_warnings: string[];
  conservative_recommendation: string;
  missing_facts: string[];
  caveats: string[];
  disagreements: string[];
  confidence: "low" | "medium" | "high";
};

function confidenceOrLow(value: unknown): "low" | "medium" | "high" {
  const v = String(value || "").toLowerCase();
  if (v === "high" || v === "medium" || v === "low") return v;
  return "low";
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

  const confidence = confidenceOrLow(parsed?.confidence);
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

function buildILAMAnswer(consensus: Omit<NormalizedIssueConsensus, "answer">): string {
  const lines: string[] = [];

  if (consensus.transaction_branches.length) {
    lines.push("Bottom line:");
    lines.push(consensus.transaction_branches[0] || "");
  }

  if (consensus.transaction_branches.length > 1) {
    lines.push("");
    lines.push("Transaction branches:");
    consensus.transaction_branches.forEach((x) => lines.push(`- ${x}`));
  }

  if (consensus.issue_results.length) {
    lines.push("");
    lines.push("Issue-level findings:");
    for (const item of consensus.issue_results) {
      lines.push(`- ${item.issue_label}: ${item.conclusion}`);
      if (item.minority_view) {
        lines.push(`  Minority but important view: ${item.minority_view}`);
      }
    }
  }

  if (consensus.cross_issue_warnings.length) {
    lines.push("");
    lines.push("Cross-issue warnings:");
    consensus.cross_issue_warnings.forEach((x) => lines.push(`- ${x}`));
  }

  if (consensus.conservative_recommendation) {
    lines.push("");
    lines.push("Conservative recommendation:");
    lines.push(consensus.conservative_recommendation);
  }

  if (consensus.missing_facts.length) {
    lines.push("");
    lines.push("Missing facts / follow-ups needed:");
    consensus.missing_facts.forEach((x) => lines.push(`- ${x}`));
  }

  return lines.join("\n").trim();
}

function normalizeIssueConsensus(parsed: IssueAdjudicationJson): NormalizedIssueConsensus {
  const issueResultsRaw = Array.isArray(parsed?.issue_results) ? parsed.issue_results : [];

  const issue_results: NormalizedIssueResult[] = issueResultsRaw
    .map((x) => ({
      issue_id: String(x?.issue_id || "").trim(),
      issue_label: String(x?.issue_label || "").trim(),
      selected_provider: String(x?.selected_provider || "").trim(),
      selected_model: String(x?.selected_model || "").trim(),
      conclusion: String(x?.conclusion || "").trim(),
      reasoning: String(x?.reasoning || "").trim(),
      minority_view: String(x?.minority_view || "").trim() || undefined,
      controlling: Boolean(x?.controlling),
      confidence: confidenceOrLow(x?.confidence),
      missing_facts: normalizeStringArray(x?.missing_facts),
    }))
    .filter((x) => x.issue_id && x.issue_label && x.conclusion);

  const normalized = {
    transaction_branches: normalizeStringArray(parsed?.transaction_branches),
    issue_results,
    cross_issue_warnings: normalizeStringArray(parsed?.cross_issue_warnings),
    conservative_recommendation: String(parsed?.conservative_recommendation || "").trim(),
    missing_facts: uniq([
      ...normalizeStringArray(parsed?.missing_facts),
      ...issue_results.flatMap((x) => x.missing_facts),
    ]),
    caveats: normalizeStringArray(parsed?.caveats),
    disagreements: normalizeStringArray(parsed?.disagreements),
    confidence: confidenceOrLow(parsed?.confidence),
  };

  const answer = buildILAMAnswer(normalized);

  return {
    ...normalized,
    answer,
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

function buildILAMSystemPrompt(label: "GPT" | "CLAUDE") {
  return [
    `You are ${label}, acting as an issue-level adjudicator for a tax crosscheck engine.`,
    "You are NOT comparing whole answers holistically.",
    "You must adjudicate ISSUE BY ISSUE.",
    "",
    "Core principle:",
    "A provider can be wrong overall but still best on one issue.",
    "A minority view must be preserved if it captures a legally controlling distinction.",
    "",
    "Instructions:",
    "1. Review the issue matrix.",
    "2. For each issue, select the provider/model with the strongest legal reasoning for that issue only.",
    "3. Do not reward fluency, completeness, or smooth prose unless it improves legal correctness for that issue.",
    "4. Preserve controlling minority distinctions in 'minority_view' when they should affect the final answer.",
    "5. Elevate transaction classification, taxpayer status, legal trigger conditions, special regimes, and missing facts.",
    "6. If the issue requires branching logic, state that in the conclusion.",
    "7. Be conservative. If facts are missing, say so explicitly.",
    "",
    "Return STRICT JSON ONLY with these exact keys:",
    "{",
    '  "bottom_line": string,',
    '  "transaction_branches": string[],',
    '  "issue_results": [',
    "    {",
    '      "issue_id": string,',
    '      "issue_label": string,',
    '      "selected_provider": string,',
    '      "selected_model": string,',
    '      "conclusion": string,',
    '      "reasoning": string,',
    '      "minority_view": string,',
    '      "controlling": boolean,',
    '      "confidence": "low" | "medium" | "high",',
    '      "missing_facts": string[]',
    "    }",
    "  ],",
    '  "cross_issue_warnings": string[],',
    '  "conservative_recommendation": string,',
    '  "missing_facts": string[],',
    '  "caveats": string[],',
    '  "disagreements": string[],',
    '  "confidence": "low" | "medium" | "high"',
    "}",
    "",
    "Important:",
    "- 'transaction_branches' should contain branch-specific outcomes when the legal result changes by fact pattern.",
    "- 'issue_results' must be populated from the issue matrix, not invented.",
    "- If no provider adequately addressed an issue, still return the issue with a conservative conclusion and low confidence.",
    "- Do not invent authority or citations.",
  ].join("\n");
}

function buildMergerSystemPrompt() {
  return [
    "You are the final merger model for an issue-level tax adjudication engine.",
    "You are receiving:",
    "1. the issue matrix,",
    "2. a GPT issue-level adjudication, and",
    "3. a Claude issue-level adjudication.",
    "",
    "Your job is to produce the safest merged issue-level result.",
    "Do NOT average holistically.",
    "Merge by issue.",
    "If one adjudicator identifies better issue-specific reasoning, keep it.",
    "If one preserves a controlling minority distinction, do not flatten it away.",
    "If transaction branches produce different legal outcomes, preserve the branch structure.",
    "Prioritize legal precision over elegance.",
    "Do not invent authority or citations.",
    "",
    "Return STRICT JSON ONLY with these exact keys:",
    "{",
    '  "bottom_line": string,',
    '  "transaction_branches": string[],',
    '  "issue_results": [',
    "    {",
    '      "issue_id": string,',
    '      "issue_label": string,',
    '      "selected_provider": string,',
    '      "selected_model": string,',
    '      "conclusion": string,',
    '      "reasoning": string,',
    '      "minority_view": string,',
    '      "controlling": boolean,',
    '      "confidence": "low" | "medium" | "high",',
    '      "missing_facts": string[]',
    "    }",
    "  ],",
    '  "cross_issue_warnings": string[],',
    '  "conservative_recommendation": string,',
    '  "missing_facts": string[],',
    '  "caveats": string[],',
    '  "disagreements": string[],',
    '  "confidence": "low" | "medium" | "high"',
    "}",
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

function inferIssueCatalog(input: CrosscheckInput, outputs: ProviderOutput[]): IssueDefinition[] {
  const q = `${input.jurisdiction || ""} ${input.question || ""} ${input.facts || ""} ${input.constraints || ""} ${outputs
    .map((o) => o.text || "")
    .join("\n")}`.toLowerCase();

  const issues: IssueDefinition[] = [
    {
      id: "transaction_classification",
      label: "Transaction classification",
      description:
        "Classify the transaction and separate materially different transaction types before stating legal consequences.",
      keywords: [
        "transaction",
        "classif",
        "sale",
        "supply",
        "goods",
        "services",
        "digital",
        "resale",
        "consumption",
        "fixed asset",
        "industrialization",
        "final consumer",
        "b2b",
        "b2c",
      ],
      priority: 100,
      alwaysInclude: true,
    },
    {
      id: "taxpayer_status",
      label: "Taxpayer status and party profile",
      description:
        "Identify whether each party is a taxpayer, final consumer, reseller, importer, or otherwise materially distinct.",
      keywords: [
        "taxpayer",
        "contributor",
        "non-contributor",
        "final consumer",
        "reseller",
        "buyer",
        "seller",
        "importer",
        "acquirer",
        "recipient",
      ],
      priority: 95,
      alwaysInclude: true,
    },
    {
      id: "applicable_taxes",
      label: "Applicable taxes and legal regime",
      description:
        "Identify the primary taxes or legal regimes that govern the transaction.",
      keywords: [
        "tax",
        "vat",
        "gst",
        "sales tax",
        "icms",
        "ipi",
        "iss",
        "pis",
        "cofins",
        "withholding",
        "customs",
      ],
      priority: 90,
      alwaysInclude: true,
    },
    {
      id: "trigger_conditions",
      label: "Trigger conditions and scope",
      description:
        "Determine what factual or legal triggers cause a rule to apply and avoid over-generalization.",
      keywords: [
        "trigger",
        "depends",
        "scope",
        "applies",
        "only if",
        "unless",
        "condition",
        "purpose",
        "use",
        "own use",
        "consumption",
      ],
      priority: 88,
      alwaysInclude: true,
    },
    {
      id: "place_of_taxation",
      label: "Origin / destination / nexus mechanics",
      description:
        "Determine whether place-of-taxation, source, origin, destination, nexus, or interstate mechanics affect the result.",
      keywords: [
        "origin",
        "destination",
        "state",
        "interstate",
        "intrastate",
        "nexus",
        "source",
        "place of supply",
        "destination state",
      ],
      priority: 84,
    },
    {
      id: "special_regimes",
      label: "Special regimes, overrides, and exceptions",
      description:
        "Identify substitution, special collection regimes, imports, exemptions, or override mechanics.",
      keywords: [
        "special regime",
        "override",
        "substitution",
        "st",
        "icms-st",
        "substituição tributária",
        "exemption",
        "exception",
        "import",
        "imported",
        "4%",
      ],
      priority: 82,
    },
    {
      id: "rate_mechanics",
      label: "Rate and base mechanics",
      description:
        "Determine whether rates, differentials, bases, or apportionment change the answer.",
      keywords: [
        "rate",
        "base",
        "differential",
        "difal",
        "4%",
        "apportionment",
        "credit",
        "rate mechanics",
      ],
      priority: 80,
    },
    {
      id: "compliance_and_documentation",
      label: "Compliance, reporting, and documentation",
      description:
        "Identify invoice, registration, reporting, collection, and documentary implications.",
      keywords: [
        "invoice",
        "report",
        "registration",
        "documentation",
        "compliance",
        "collection",
        "remittance",
        "filing",
      ],
      priority: 72,
    },
    {
      id: "missing_facts",
      label: "Missing facts and factual dependencies",
      description:
        "Identify unresolved facts that materially affect the legal answer.",
      keywords: [
        "missing facts",
        "assumption",
        "depends on facts",
        "unknown",
        "unclear",
        "verify",
        "need to confirm",
      ],
      priority: 70,
      alwaysInclude: true,
    },
  ];

  const maybeAdd = (issue: IssueDefinition) => {
    if (!issues.find((x) => x.id === issue.id)) issues.push(issue);
  };

  if (q.includes("brazil") || q.includes("brasil") || q.includes("icms")) {
    maybeAdd({
      id: "brazil_icms_core",
      label: "ICMS core regime",
      description:
        "Determine whether ICMS is the primary regime and avoid blending it with other taxes without reason.",
      keywords: ["icms", "interstate", "goods", "mercadorias", "state vat"],
      priority: 98,
      alwaysInclude: true,
    });

    maybeAdd({
      id: "brazil_difal",
      label: "DIFAL applicability",
      description:
        "Determine when DIFAL is relevant and separate B2B resale, B2B own use / fixed assets, and B2C / final consumer.",
      keywords: [
        "difal",
        "diferencial",
        "final consumer",
        "consumption",
        "fixed asset",
        "resale",
        "non-contributor",
        "contributor",
      ],
      priority: 97,
      alwaysInclude: true,
    });

    maybeAdd({
      id: "brazil_icms_st",
      label: "ICMS-ST override",
      description:
        "Determine whether ICMS-ST or substitution mechanics override the ordinary interstate analysis.",
      keywords: ["icms-st", "st", "substituição tributária", "substitution"],
      priority: 94,
    });

    maybeAdd({
      id: "brazil_import_4_percent",
      label: "4% interstate rate for imported goods",
      description:
        "Determine whether the 4% interstate rate for imported goods materially affects the answer.",
      keywords: ["4%", "imported", "import content", "resolução 13", "interstate rate"],
      priority: 90,
    });
  }

  return issues
    .filter((issue) => {
      if (issue.alwaysInclude) return true;
      return issue.keywords.some((k) => q.includes(k.toLowerCase()));
    })
    .sort((a, b) => b.priority - a.priority);
}

function collectIssueSnippetsForProvider(
  provider: ProviderOutput,
  issue: IssueDefinition
): IssueNode {
  const snippets = splitIntoSnippets(provider.text || "");
  const matched = snippets.filter((s) => {
    const lower = s.toLowerCase();
    return issue.keywords.some((k) => lower.includes(k.toLowerCase()));
  });

  const selected = matched.slice(0, 6).map((x) => truncate(x, 500));

  const synthesized =
    selected.length > 0
      ? selected.join(" | ")
      : truncate(provider.text || provider.error || "", 700);

  return {
    issueId: issue.id,
    issueLabel: issue.label,
    provider: provider.provider,
    model: provider.model,
    status: provider.status,
    snippets: selected,
    synthesized,
  };
}

function buildIssueMatrix(input: CrosscheckInput, outputs: ProviderOutput[]): IssueMatrix {
  const issues = inferIssueCatalog(input, outputs);
  const okProviders = outputs.filter((o) => o.status === "ok" && (o.text || "").trim());

  const nodes: Record<string, IssueNode[]> = {};

  for (const issue of issues) {
    nodes[issue.id] = okProviders.map((p) => collectIssueSnippetsForProvider(p, issue));
  }

  return { issues, nodes };
}

function serializeIssueMatrix(matrix: IssueMatrix): string {
  const compact = {
    issues: matrix.issues.map((issue) => ({
      issue_id: issue.id,
      issue_label: issue.label,
      description: issue.description,
    })),
    nodes: Object.fromEntries(
      Object.entries(matrix.nodes).map(([issueId, nodes]) => [
        issueId,
        nodes.map((node) => ({
          provider: node.provider,
          model: node.model,
          status: node.status,
          snippets: node.snippets.slice(0, 6),
          synthesized: truncate(node.synthesized, 900),
        })),
      ])
    ),
  };

  return JSON.stringify(compact, null, 2);
}

async function adjudicateIssueMatrixWithOpenAI(args: {
  input: CrosscheckInput;
  matrix: IssueMatrix;
}): Promise<NormalizedIssueConsensus | null> {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) return null;

  const model =
    env("OPENAI_ISSUE_ADJUDICATOR_MODEL") ||
    env("OPENAI_ADJUDICATOR_MODEL") ||
    env("OPENAI_SYNTH_MODEL") ||
    env("OPENAI_MODEL") ||
    "gpt-4.1-mini";

  const client = new OpenAI({ apiKey });
  const matrixJson = serializeIssueMatrix(args.matrix);

  const user = [
    args.input.jurisdiction ? `Jurisdiction: ${args.input.jurisdiction}` : "",
    args.input.constraints ? `Constraints: ${args.input.constraints}` : "",
    args.input.facts ? `Facts:\n${args.input.facts}` : "",
    `Question:\n${args.input.question}`,
    "",
    "Issue matrix:",
    matrixJson,
  ]
    .filter(Boolean)
    .join("\n\n");

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      { role: "system", content: buildILAMSystemPrompt("GPT") },
      { role: "user", content: user },
    ],
    max_tokens: clampInt((args.input as any)?.maxTokens, 900, 2600, 1800),
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";
  const extracted = extractJsonObject(raw);
  const parsed = safeJsonParse<IssueAdjudicationJson>(extracted);
  if (!parsed) return null;

  return normalizeIssueConsensus(parsed);
}

async function adjudicateIssueMatrixWithClaude(args: {
  input: CrosscheckInput;
  matrix: IssueMatrix;
}): Promise<NormalizedIssueConsensus | null> {
  const matrixJson = serializeIssueMatrix(args.matrix);

  const prompt = [
    args.input.jurisdiction ? `Jurisdiction: ${args.input.jurisdiction}` : "",
    args.input.constraints ? `Constraints: ${args.input.constraints}` : "",
    args.input.facts ? `Facts:\n${args.input.facts}` : "",
    `Question:\n${args.input.question}`,
    "",
    "Issue matrix:",
    matrixJson,
    "",
    buildILAMSystemPrompt("CLAUDE"),
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await callAnthropic({
    ...args.input,
    question: prompt,
    maxTokens: clampInt((args.input as any)?.maxTokens, 900, 3200, 2000),
  });

  if (result.status !== "ok" || !result.text) return null;

  const extracted = extractJsonObject(result.text);
  const parsed = safeJsonParse<IssueAdjudicationJson>(extracted);
  if (!parsed) return null;

  return normalizeIssueConsensus(parsed);
}

async function mergeIssueAdjudicationsWithOpenAI(args: {
  input: CrosscheckInput;
  matrix: IssueMatrix;
  gpt: NormalizedIssueConsensus | null;
  claude: NormalizedIssueConsensus | null;
}): Promise<NormalizedIssueConsensus | null> {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) return args.gpt || args.claude || null;

  const model =
    env("OPENAI_MERGER_MODEL") ||
    env("OPENAI_ISSUE_ADJUDICATOR_MODEL") ||
    env("OPENAI_ADJUDICATOR_MODEL") ||
    env("OPENAI_SYNTH_MODEL") ||
    env("OPENAI_MODEL") ||
    "gpt-4.1-mini";

  const client = new OpenAI({ apiKey });

  const matrixJson = serializeIssueMatrix(args.matrix);
  const gptJson = JSON.stringify(args.gpt || {}, null, 2);
  const claudeJson = JSON.stringify(args.claude || {}, null, 2);

  const user = [
    args.input.jurisdiction ? `Jurisdiction: ${args.input.jurisdiction}` : "",
    args.input.constraints ? `Constraints: ${args.input.constraints}` : "",
    args.input.facts ? `Facts:\n${args.input.facts}` : "",
    `Question:\n${args.input.question}`,
    "",
    "Issue matrix:",
    matrixJson,
    "",
    "GPT issue adjudication:",
    gptJson,
    "",
    "Claude issue adjudication:",
    claudeJson,
  ]
    .filter(Boolean)
    .join("\n\n");

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      { role: "system", content: buildMergerSystemPrompt() },
      { role: "user", content: user },
    ],
    max_tokens: 2200,
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";
  const extracted = extractJsonObject(raw);
  const parsed = safeJsonParse<IssueAdjudicationJson>(extracted);
  if (!parsed) return args.gpt || args.claude || null;

  return normalizeIssueConsensus(parsed);
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
  let finalIssueConsensus: NormalizedIssueConsensus | null = null;

  if (succeededCalls.length >= 2) {
    const matrix = buildIssueMatrix(input, providers);

    if (dualAdjudicatorEnabled()) {
      const [gptIssueAdj, claudeIssueAdj] = await Promise.all([
        adjudicateIssueMatrixWithOpenAI({ input, matrix }).catch(() => null),
        adjudicateIssueMatrixWithClaude({ input, matrix }).catch(() => null),
      ]);

      finalIssueConsensus = await mergeIssueAdjudicationsWithOpenAI({
        input,
        matrix,
        gpt: gptIssueAdj,
        claude: claudeIssueAdj,
      }).catch(() => gptIssueAdj || claudeIssueAdj || null);
    } else {
      finalIssueConsensus = await adjudicateIssueMatrixWithOpenAI({
        input,
        matrix,
      }).catch(() => null);
    }
  }

  if (!finalIssueConsensus) {
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
  }

  const answer =
    finalIssueConsensus?.answer ||
    finalConsensus?.answer ||
    best?.text?.trim() ||
    `I couldn't get a successful provider response yet. Providers attempted: ${attempted
      .map((a) => `${a.provider}:${a.model}`)
      .join(", ")}`;

  const caveats = uniq([
    ...(finalIssueConsensus?.caveats || []),
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

  const followups = uniq([
    ...(finalIssueConsensus?.missing_facts || []),
    ...(finalConsensus?.followups || []),
  ]);

  const disagreements = uniq([
    ...(finalIssueConsensus?.disagreements || []),
    ...(finalConsensus?.disagreements || []),
    ...(finalIssueConsensus?.cross_issue_warnings || []),
  ]);

  const confidence =
    finalIssueConsensus?.confidence ||
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
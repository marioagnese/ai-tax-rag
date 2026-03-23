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

function truncate(s: string, max = 1000): string {
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

type MemoJson = {
  executive_summary?: string;
  analysis?: string;
  transaction_specific_treatment?: string[];
  required_confirmations?: string[];
  recommendation?: string;
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

type MemoIssueResultJson = {
  issue_id?: string;
  issue_label?: string;
  selected_provider?: string;
  selected_model?: string;
  conclusion?: string;
  reasoning?: string;
  controlling?: boolean;
  confidence?: "low" | "medium" | "high" | string;
  missing_facts?: string[];
};

type MemoIssueAdjudicationJson = {
  executive_summary?: string;
  analysis?: string;
  transaction_specific_treatment?: string[];
  issue_results?: MemoIssueResultJson[];
  required_confirmations?: string[];
  recommendation?: string;
  confidence?: "low" | "medium" | "high" | string;
};

type NormalizedMemo = {
  answer: string;
  executive_summary: string;
  analysis: string;
  transaction_specific_treatment: string[];
  required_confirmations: string[];
  recommendation: string;
  confidence: "low" | "medium" | "high";
};

function confidenceOrLow(value: unknown): "low" | "medium" | "high" {
  const v = String(value || "").toLowerCase();
  if (v === "high" || v === "medium" || v === "low") return v;
  return "low";
}

function cleanMemoText(s: string): string {
  return String(s || "")
    .replace(/\bcommon ground\b:?/gi, "")
    .replace(/\bdifferences in emphasis\b:?/gi, "")
    .replace(/\bminority view\b:?/gi, "")
    .replace(/\bone model\b/gi, "")
    .replace(/\bsome models\b/gi, "")
    .replace(/\bconsult (?:local )?counsel\b/gi, "obtain targeted review where needed")
    .replace(/\bcontact tax authorities\b/gi, "confirm the applicable rule set")
    .replace(/\bpenalt(?:y|ies)\b[^.]*\./gi, "")
    .replace(/\bselic\b[^.]*\./gi, "")
    .replace(/\bsupreme federal court\b[^.]*\./gi, "")
    .replace(/\bongoing constitutional challenges\b[^.]*\./gi, "")
    .replace(/\bphase-?in\b[^.]*\./gi, "")
    .replace(/\bconstitutional amendment 132\/2023\b[^.]*\./gi, "")
    .replace(/\bpis\/cofins\b[^.]*\./gi, "")
    .replace(/\bipi\b[^.]*\./gi, "")
    .replace(/\bgnre\b[^.]*\./gi, "")
    .replace(/\bcfop\b[^.]*\./gi, "")
    .replace(/\bfci declaration\b[^.]*\./gi, "")
    .replace(/\belectronic invoic(?:e|ing)\b[^.]*\./gi, "")
    .replace(/\bnf-e\b[^.]*\./gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanMemoArray(values: string[]): string[] {
  return uniq(
    values
      .map(cleanMemoText)
      .map((x) => x.replace(/^[•\-]\s*/, "").trim())
      .filter(Boolean)
      .filter((x) => x.length > 8)
  );
}

function buildMemoAnswer(parsed: Omit<NormalizedMemo, "answer">): string {
  const lines: string[] = [];

  if (parsed.executive_summary) {
    lines.push("Executive summary");
    lines.push(parsed.executive_summary);
  }

  if (parsed.analysis) {
    lines.push("");
    lines.push("Analysis");
    lines.push(parsed.analysis);
  }

  if (parsed.transaction_specific_treatment.length) {
    lines.push("");
    lines.push("Transaction-specific treatment");
    parsed.transaction_specific_treatment.forEach((x) => lines.push(`- ${x}`));
  }

  if (parsed.required_confirmations.length) {
    lines.push("");
    lines.push("Required confirmations");
    parsed.required_confirmations.forEach((x) => lines.push(`- ${x}`));
  }

  if (parsed.recommendation) {
    lines.push("");
    lines.push("Recommendation");
    lines.push(parsed.recommendation);
  }

  return lines.join("\n").trim();
}

function normalizeMemo(parsed: MemoJson): NormalizedMemo {
  const normalized = {
    executive_summary: cleanMemoText(String(parsed?.executive_summary || "").trim()),
    analysis: cleanMemoText(String(parsed?.analysis || "").trim()),
    transaction_specific_treatment: cleanMemoArray(
      normalizeStringArray(parsed?.transaction_specific_treatment)
    ),
    required_confirmations: cleanMemoArray(
      normalizeStringArray(parsed?.required_confirmations)
    ),
    recommendation: cleanMemoText(String(parsed?.recommendation || "").trim()),
    confidence: confidenceOrLow(parsed?.confidence),
  };

  const answer = buildMemoAnswer(normalized);

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
      const body = truncate(o.text || o.error || "", 12000);
      return `${head}\n${body}`;
    })
    .join("\n\n");
}

function buildProviderWorkPrompt(input: CrosscheckInput, providerLabel: string): string {
  const body = [
    `You are ${providerLabel}, acting as a senior international tax associate preparing an internal tax memo.`,
    "You are NOT a chatbot.",
    "You are NOT writing a general explanation, tax alert, or study note.",
    "You are producing a concise, decision-useful tax analysis.",
    "",
    "OBJECTIVE",
    "Answer the question using professional tax reasoning.",
    "Your answer must:",
    "- identify the governing tax regime",
    "- identify the controlling legal distinctions",
    "- separate transaction types where the outcome changes",
    "- avoid over-generalization",
    "- avoid including non-central taxes or side topics",
    "- read like a memo, not a primer",
    "",
    "MANDATORY REASONING PROCESS (DO THIS BEFORE WRITING)",
    "1. Classify the transaction",
    "   - What is being sold? goods / services / digital",
    "   - Cross-border or domestic?",
    "   - Any special context (import, resale, consumption, etc.)",
    "2. Identify the controlling variables",
    "   - buyer status (taxpayer vs non-taxpayer)",
    "   - purpose (resale vs own use / fixed asset)",
    "   - product category (if relevant)",
    "   - place-of-taxation mechanics (origin vs destination)",
    "3. Identify what actually changes the legal outcome",
    "   - Do NOT treat all cases as one",
    "   - Separate branches where the answer differs",
    "4. Exclude non-essential topics",
    "   - Do NOT include other taxes unless required",
    "   - Do NOT include compliance mechanics unless outcome-relevant",
    "   - Do NOT include penalties or litigation",
    "",
    "SELF-CRITIQUE BEFORE FINALIZING",
    "Review your draft critically:",
    "1. Did I clearly identify the governing tax?",
    "2. Did I separate transaction types where the outcome changes?",
    "3. Did I incorrectly generalize any conditional rule?",
    "4. Did I include non-central topics that should be removed?",
    "5. Does this read like a memo or like a textbook?",
    "6. Is the conclusion clear and owned?",
    "Rewrite the answer to improve precision, structure, memo tone, and removal of unnecessary content.",
    "",
    "SCOPE DISCIPLINE",
    "- Answer only the tax question asked.",
    "- Do not include ancillary taxes unless necessary to avoid a materially incomplete answer.",
    "- Do not include litigation, reform, penalty ranges, filing mechanics, registration mechanics, or workflow details unless the question asks for them or they are outcome-determinative.",
    "- If the question is general, prioritize the governing tax and the controlling legal distinctions.",
    "- Prefer a shorter, controlled memo over a broader but noisier answer.",
    "",
    "OUTPUT FORMAT (STRICT JSON ONLY)",
    "{",
    '  "executive_summary": string,',
    '  "analysis": string,',
    '  "transaction_specific_treatment": string[],',
    '  "required_confirmations": string[],',
    '  "recommendation": string,',
    '  "confidence": "low" | "medium" | "high"',
    "}",
    "",
    "STYLE RULES",
    "- Sound like a tax professional, not an AI",
    "- Be concise and controlled",
    "- Avoid 'generally', 'typically', unless necessary",
    "- Do not recommend consulting authorities",
    "- Do not include penalties or scare language",
    "- Do not try to be exhaustive — be precise",
    "- Do not invent authority or citations",
    "",
    input.jurisdiction ? `Jurisdiction: ${input.jurisdiction}` : "",
    input.constraints ? `Constraints: ${input.constraints}` : "",
    input.facts ? `Facts:\n${input.facts}` : "",
    `Question:\n${input.question}`,
  ]
    .filter(Boolean)
    .join("\n");

  return body;
}

function adaptProviderOutputToMemoText(rawText: string): string {
  const extracted = extractJsonObject(rawText);
  const parsed = safeJsonParse<MemoJson>(extracted);
  if (!parsed) return rawText;
  return buildMemoAnswer(normalizeMemo(parsed));
}

function genericityPenalty(text: string): number {
  const t = text.toLowerCase();

  const penaltyTerms = [
    "state-specific rules create complexity",
    "consult local tax",
    "consult a professional",
    "may vary",
    "depends on the facts",
    "penalties and interest",
    "seek local counsel",
    "contact tax authorities",
    "ongoing litigation",
    "tax reform",
    "nf-e",
    "gnre",
    "cfop",
    "pis/cofins",
    "ipi",
  ];

  return penaltyTerms.filter((x) => t.includes(x)).length * 90;
}

function memoQualityBonus(text: string): number {
  const t = text.toLowerCase();

  const bonuses = [
    "executive summary",
    "analysis",
    "transaction-specific treatment",
    "required confirmations",
    "recommendation",
    "resale",
    "own use",
    "fixed asset",
    "final consumer",
    "non-taxpayer",
    "non-contributor",
    "industrialization",
  ];

  return bonuses.filter((x) => t.includes(x)).length * 70;
}

function branchDisciplineBonus(text: string): number {
  const t = text.toLowerCase();

  let score = 0;
  if (t.includes("resale")) score += 120;
  if (t.includes("own use") || t.includes("fixed asset")) score += 120;
  if (t.includes("final consumer") || t.includes("non-taxpayer") || t.includes("non-contributor")) score += 120;
  if (t.includes("transaction-specific treatment")) score += 80;
  return score;
}

function overgeneralizationPenalty(text: string): number {
  const t = text.toLowerCase();

  const badPatterns = [
    "all interstate sales",
    "interstate sales are subject to",
    "difal applies to interstate sales",
    "only interstate rate applies",
    "the total effective rate typically reaches",
    "destination state collects an additional difal amount",
  ];

  return badPatterns.filter((x) => t.includes(x)).length * 120;
}

function pickBest(outputs: ProviderOutput[]): ProviderOutput | null {
  const ok = outputs.filter(
    (o) => o.status === "ok" && (o.text || "").trim().length > 50
  );
  if (!ok.length) return null;

  const scored = ok.map((o) => {
    const text = o.text || "";
    const refusalPenalty = ["i don't know", "cannot", "unable", "no information"].some((k) =>
      text.toLowerCase().includes(k)
    )
      ? 1
      : 0;

    const usefulSignals =
      [
        "however",
        "but",
        "risk",
        "missing facts",
        "assumption",
        "difal",
        "final consumer",
        "fixed asset",
        "consumption",
        "resale",
        "industrialization",
        "constitutional",
        "complementary law",
        "article 155",
        "kandir",
        "contributor",
        "non-contributor",
      ].filter((k) => text.toLowerCase().includes(k)).length * 60;

    const len = text.length;

    const score =
      len +
      usefulSignals +
      memoQualityBonus(text) +
      branchDisciplineBonus(text) -
      refusalPenalty * 500 -
      genericityPenalty(text) -
      overgeneralizationPenalty(text);

    return { o, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].o;
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
        "non-taxpayer",
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
        "non-taxpayer",
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

function buildMemoIssuePrompt(label: "GPT" | "CLAUDE") {
  return [
    `You are ${label}, acting as an issue-level tax adjudicator.`,
    "You must adjudicate issue by issue, but the final result must read like one integrated internal tax memo.",
    "You are not writing a model comparison.",
    "",
    "YOUR JOB",
    "Evaluate provider outputs based on reasoning quality, not agreement.",
    "",
    "EVALUATION CRITERIA",
    "1. Issue identification",
    "   - Did the provider identify the correct tax regime?",
    "   - Did it identify the controlling legal question?",
    "2. Legal distinctions (MOST IMPORTANT)",
    "   - Did it separate transaction types correctly?",
    "   - Did it distinguish resale vs own use / fixed assets?",
    "   - Did it distinguish taxpayer vs non-taxpayer / final consumer?",
    "3. Over-generalization",
    "   - Did it incorrectly state conditional rules as universal?",
    "4. Scope discipline",
    "   - Did it include unnecessary taxes or topics?",
    "   - Did it drift into compliance or operational detail?",
    "5. Memo quality",
    "   - Does it read like a professional tax memo?",
    "   - Or like a generic explanation?",
    "",
    "ADJUDICATION RULES",
    "1. The most legally precise answer wins, even if it is a minority view.",
    "2. Do NOT average answers.",
    "3. Do NOT merge noise.",
    "4. You may discard entire answers or extract only one correct section from a model.",
    "",
    "SCOPE DISCIPLINE",
    "- Answer only the tax question asked.",
    "- Omit ancillary taxes and side topics unless outcome-determinative.",
    "- Omit litigation, reform, penalties, filing mechanics, and operational steps unless necessary to the legal answer.",
    "- Prefer a cleaner memo over a fuller but noisier one.",
    "",
    "Return STRICT JSON ONLY with these exact keys:",
    "{",
    '  "executive_summary": string,',
    '  "analysis": string,',
    '  "transaction_specific_treatment": string[],',
    '  "issue_results": [',
    "    {",
    '      "issue_id": string,',
    '      "issue_label": string,',
    '      "selected_provider": string,',
    '      "selected_model": string,',
    '      "conclusion": string,',
    '      "reasoning": string,',
    '      "controlling": boolean,',
    '      "confidence": "low" | "medium" | "high",',
    '      "missing_facts": string[]',
    "    }",
    "  ],",
    '  "required_confirmations": string[],',
    '  "recommendation": string,',
    '  "confidence": "low" | "medium" | "high"',
    "}",
    "",
    "Important:",
    "- analysis must sound like a tax memo, not an adjudication report.",
    "- transaction_specific_treatment should contain fact-pattern-dependent outcomes only.",
    "- issue_results exist for internal support, but the memo must stand on its own.",
    "- Do not invent authority or citations.",
    "",
    "FINAL CHECK",
    'Ask yourself: "Would I send this to a business stakeholder?"',
    "If not, rewrite.",
  ].join("\n");
}

function buildMemoMergerPrompt() {
  return [
    "You are the final merger model for a tax adjudication engine.",
    "You are receiving:",
    "1. the issue matrix,",
    "2. a GPT issue-level adjudication, and",
    "3. a Claude issue-level adjudication.",
    "",
    "Your job is to produce the safest final internal tax memo.",
    "Do NOT write a comparison of the adjudications.",
    "Do NOT mention agreement/disagreement between adjudicators or providers.",
    "Resolve the conflicts yourself and present one integrated legal answer.",
    "",
    "Tone rules:",
    "- Write like a concise internal tax memo.",
    "- Do not recommend contacting tax authorities.",
    "- Do not include generic penalty lists or boilerplate disclaimers.",
    "- Do not let the answer drift into chatbot language.",
    "",
    "Scope discipline:",
    "- Answer only the tax question asked.",
    "- Omit ancillary taxes unless they are necessary to avoid a materially incomplete answer.",
    "- Omit litigation, reform, penalty ranges, filing mechanics, registration mechanics, and workflow details unless the question asks for them or they are outcome-determinative.",
    "- If the question is general, focus on the governing tax and controlling distinctions.",
    "- Prefer memo usefulness over broad technical completeness.",
    "",
    "Substantive rules:",
    "1. Preserve legally controlling distinctions.",
    "2. Where the legal outcome changes by facts, present transaction-specific treatment.",
    "3. Prefer legal precision over smooth but over-broad summary.",
    "4. Keep required confirmations limited to facts that actually matter.",
    "5. Do not invent authority or citations.",
    "",
    "Return STRICT JSON ONLY with these exact keys:",
    "{",
    '  "executive_summary": string,',
    '  "analysis": string,',
    '  "transaction_specific_treatment": string[],',
    '  "issue_results": [',
    "    {",
    '      "issue_id": string,',
    '      "issue_label": string,',
    '      "selected_provider": string,',
    '      "selected_model": string,',
    '      "conclusion": string,',
    '      "reasoning": string,',
    '      "controlling": boolean,',
    '      "confidence": "low" | "medium" | "high",',
    '      "missing_facts": string[]',
    "    }",
    "  ],",
    '  "required_confirmations": string[],',
    '  "recommendation": string,',
    '  "confidence": "low" | "medium" | "high"',
    "}",
  ].join("\n");
}

async function adjudicateMemoIssueMatrixWithOpenAI(args: {
  input: CrosscheckInput;
  matrix: IssueMatrix;
}): Promise<NormalizedMemo | null> {
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
      { role: "system", content: buildMemoIssuePrompt("GPT") },
      { role: "user", content: user },
    ],
    max_tokens: clampInt((args.input as any)?.maxTokens, 900, 2800, 1900),
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";
  const extracted = extractJsonObject(raw);
  const parsed = safeJsonParse<MemoIssueAdjudicationJson>(extracted);

  if (!parsed) return null;

  return normalizeMemo({
    executive_summary: parsed.executive_summary,
    analysis: parsed.analysis,
    transaction_specific_treatment: parsed.transaction_specific_treatment,
    required_confirmations: uniq([
      ...normalizeStringArray(parsed.required_confirmations),
      ...((Array.isArray(parsed.issue_results) ? parsed.issue_results : []).flatMap((x) =>
        normalizeStringArray(x?.missing_facts)
      )),
    ]),
    recommendation: parsed.recommendation,
    confidence: parsed.confidence,
  });
}

async function adjudicateMemoIssueMatrixWithClaude(args: {
  input: CrosscheckInput;
  matrix: IssueMatrix;
}): Promise<NormalizedMemo | null> {
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
    buildMemoIssuePrompt("CLAUDE"),
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await callAnthropic({
    ...args.input,
    question: prompt,
    maxTokens: clampInt((args.input as any)?.maxTokens, 900, 3200, 2100),
  });

  if (result.status !== "ok" || !result.text) return null;

  const extracted = extractJsonObject(result.text);
  const parsed = safeJsonParse<MemoIssueAdjudicationJson>(extracted);

  if (!parsed) return null;

  return normalizeMemo({
    executive_summary: parsed.executive_summary,
    analysis: parsed.analysis,
    transaction_specific_treatment: parsed.transaction_specific_treatment,
    required_confirmations: uniq([
      ...normalizeStringArray(parsed.required_confirmations),
      ...((Array.isArray(parsed.issue_results) ? parsed.issue_results : []).flatMap((x) =>
        normalizeStringArray(x?.missing_facts)
      )),
    ]),
    recommendation: parsed.recommendation,
    confidence: parsed.confidence,
  });
}

async function mergeMemoIssueAdjudicationsWithOpenAI(args: {
  input: CrosscheckInput;
  matrix: IssueMatrix;
  gpt: NormalizedMemo | null;
  claude: NormalizedMemo | null;
}): Promise<NormalizedMemo | null> {
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
      { role: "system", content: buildMemoMergerPrompt() },
      { role: "user", content: user },
    ],
    max_tokens: 2300,
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";
  const extracted = extractJsonObject(raw);
  const parsed = safeJsonParse<MemoIssueAdjudicationJson>(extracted);

  if (!parsed) return args.gpt || args.claude || null;

  return normalizeMemo({
    executive_summary: parsed.executive_summary,
    analysis: parsed.analysis,
    transaction_specific_treatment: parsed.transaction_specific_treatment,
    required_confirmations: uniq([
      ...normalizeStringArray(parsed.required_confirmations),
      ...((Array.isArray(parsed.issue_results) ? parsed.issue_results : []).flatMap((x) =>
        normalizeStringArray(x?.missing_facts)
      )),
    ]),
    recommendation: parsed.recommendation,
    confidence: parsed.confidence,
  });
}

function wrapInputForProvider(
  input: CrosscheckInput,
  providerLabel: string
): CrosscheckInput {
  return {
    ...input,
    question: buildProviderWorkPrompt(input, providerLabel),
  };
}

function repackageProviderOutput(
  out: ProviderOutput,
  originalProvider: ProviderOutput["provider"]
): ProviderOutput {
  if (out.status !== "ok" || !out.text) return out;

  const memoText = adaptProviderOutputToMemoText(out.text);

  return {
    ...out,
    provider: originalProvider,
    text: memoText,
  };
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
    wrap({ provider: "openai", model: openaiModel }, async () => {
      const result = await callOpenAI(wrapInputForProvider(input, "OpenAI"));
      return repackageProviderOutput(result, "openai");
    })
  );

  for (const m of defaultOpenRouterModels()) {
    tasks.push(
      wrap({ provider: "openrouter", model: m }, async () => {
        const result = await callOpenRouter(wrapInputForProvider(input, m), m);
        return repackageProviderOutput(result, "openrouter");
      })
    );
  }

  if (geminiEnabled()) {
    const geminiModel = env("GEMINI_MODEL") || "gemini-2.5-flash";
    tasks.push(
      wrap({ provider: "gemini", model: geminiModel }, async () => {
        const result = await callGemini(wrapInputForProvider(input, "Gemini"));
        return repackageProviderOutput(result, "gemini");
      })
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

  let finalMemo: NormalizedMemo | null = null;

  if (succeededCalls.length >= 2) {
    const matrix = buildIssueMatrix(input, providers);

    if (dualAdjudicatorEnabled()) {
      const [gptIssueAdj, claudeIssueAdj] = await Promise.all([
        adjudicateMemoIssueMatrixWithOpenAI({ input, matrix }).catch(() => null),
        adjudicateMemoIssueMatrixWithClaude({ input, matrix }).catch(() => null),
      ]);

      finalMemo = await mergeMemoIssueAdjudicationsWithOpenAI({
        input,
        matrix,
        gpt: gptIssueAdj,
        claude: claudeIssueAdj,
      }).catch(() => gptIssueAdj || claudeIssueAdj || null);
    } else {
      finalMemo = await adjudicateMemoIssueMatrixWithOpenAI({
        input,
        matrix,
      }).catch(() => null);
    }
  }

  if (!finalMemo) {
    const fallbackText = best?.text?.trim() || "";

    if (fallbackText) {
      finalMemo = normalizeMemo({
        executive_summary: splitIntoSnippets(fallbackText)[0] || fallbackText,
        analysis: fallbackText,
        transaction_specific_treatment: [],
        required_confirmations: [],
        recommendation: "",
        confidence: succeededCalls.length >= 2 ? "medium" : "low",
      });
    }
  }

  const answer =
    finalMemo?.answer ||
    best?.text?.trim() ||
    `I couldn't get a successful provider response yet. Providers attempted: ${attempted
      .map((a) => `${a.provider}:${a.model}`)
      .join(", ")}`;

  const followups = uniq(finalMemo?.required_confirmations || []);
  const caveats = uniq(
    !succeededCalls.length
      ? [
          "No providers returned a successful answer. Check API keys, model names, and network access.",
        ]
      : succeededCalls.length === 1
      ? [
          "Only one provider returned a successful answer, so the result is weaker than a true cross-model adjudication.",
        ]
      : []
  );

  const confidence =
    finalMemo?.confidence ||
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
      disagreements: [],
    },
    providers,
  };
}
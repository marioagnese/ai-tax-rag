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

function truncate(s: string, max = 900): string {
  const v = String(s || "").trim();
  if (v.length <= max) return v;
  return `${v.slice(0, max - 3).trim()}...`;
}

type NarrativeAdjudicationJson = {
  bottom_line?: string;
  technical_analysis?: string;
  branch_analysis?: string[];
  key_risks?: string[];
  missing_facts?: string[];
  practical_recommendation?: string;
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

type NarrativeIssueResultJson = {
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

type NarrativeIssueAdjudicationJson = {
  bottom_line?: string;
  technical_analysis?: string;
  branch_analysis?: string[];
  issue_results?: NarrativeIssueResultJson[];
  key_risks?: string[];
  missing_facts?: string[];
  practical_recommendation?: string;
  confidence?: "low" | "medium" | "high" | string;
};

type NormalizedNarrativeConsensus = {
  answer: string;
  bottom_line: string;
  technical_analysis: string;
  branch_analysis: string[];
  key_risks: string[];
  missing_facts: string[];
  practical_recommendation: string;
  confidence: "low" | "medium" | "high";
};

function confidenceOrLow(value: unknown): "low" | "medium" | "high" {
  const v = String(value || "").toLowerCase();
  if (v === "high" || v === "medium" || v === "low") return v;
  return "low";
}

function buildNarrativeAnswer(parsed: Omit<NormalizedNarrativeConsensus, "answer">): string {
  const lines: string[] = [];

  if (parsed.bottom_line) {
    lines.push("Bottom line:");
    lines.push(parsed.bottom_line);
  }

  if (parsed.technical_analysis) {
    lines.push("");
    lines.push("Technical analysis:");
    lines.push(parsed.technical_analysis);
  }

  if (parsed.branch_analysis.length) {
    lines.push("");
    lines.push("Branch analysis:");
    parsed.branch_analysis.forEach((x) => lines.push(`- ${x}`));
  }

  if (parsed.key_risks.length) {
    lines.push("");
    lines.push("Key risks / caveats:");
    parsed.key_risks.forEach((x) => lines.push(`- ${x}`));
  }

  if (parsed.missing_facts.length) {
    lines.push("");
    lines.push("Missing facts / follow-ups needed:");
    parsed.missing_facts.forEach((x) => lines.push(`- ${x}`));
  }

  if (parsed.practical_recommendation) {
    lines.push("");
    lines.push("Practical recommendation:");
    lines.push(parsed.practical_recommendation);
  }

  return lines.join("\n").trim();
}

function normalizeNarrativeConsensus(parsed: NarrativeAdjudicationJson): NormalizedNarrativeConsensus {
  const normalized = {
    bottom_line: String(parsed?.bottom_line || "").trim(),
    technical_analysis: String(parsed?.technical_analysis || "").trim(),
    branch_analysis: normalizeStringArray(parsed?.branch_analysis),
    key_risks: normalizeStringArray(parsed?.key_risks),
    missing_facts: normalizeStringArray(parsed?.missing_facts),
    practical_recommendation: String(parsed?.practical_recommendation || "").trim(),
    confidence: confidenceOrLow(parsed?.confidence),
  };

  const answer = buildNarrativeAnswer(normalized);

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
        "nf-e",
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

function buildNarrativeAdjudicationPrompt(label: "GPT" | "CLAUDE") {
  return [
    `You are ${label}, acting as a senior tax adjudicator inside a multi-model tax analysis platform.`,
    "You are NOT writing a comparison report about model outputs.",
    "You are writing the final professional tax answer.",
    "",
    "Use the provider outputs only as research inputs.",
    "Resolve conflicts yourself and present one integrated legal analysis in your own voice.",
    "Do NOT say things like 'some models said', 'one model emphasized', 'common ground', 'differences in emphasis', or 'minority view' in the user-facing answer.",
    "",
    "Core principles:",
    "1. A legally controlling distinction overrides broader but over-generalized consensus.",
    "2. A minority position should be adopted if it is more legally precise and outcome-determinative.",
    "3. Separate transaction profiles when the legal answer changes by buyer status, transaction purpose, product type, or place-of-taxation mechanics.",
    "4. Do not state conditional rules as universal rules.",
    "5. Be conservative and explicit where facts are missing.",
    "",
    "When relevant, separate these transaction categories instead of blending them:",
    "- B2B for resale / industrialization",
    "- B2B for own use, consumption, or fixed assets",
    "- B2C / final consumer / non-taxpayer",
    "",
    "Return STRICT JSON ONLY with these exact keys:",
    "{",
    '  "bottom_line": string,',
    '  "technical_analysis": string,',
    '  "branch_analysis": string[],',
    '  "key_risks": string[],',
    '  "missing_facts": string[],',
    '  "practical_recommendation": string,',
    '  "confidence": "low" | "medium" | "high"',
    "}",
    "",
    "Output rules:",
    "- bottom_line: concise professional conclusion.",
    "- technical_analysis: integrated narrative analysis in tax-professional style.",
    "- branch_analysis: only include separate branches where legal outcomes differ by facts.",
    "- key_risks: legal/compliance risks and caveats, not meta-comments about the models.",
    "- practical_recommendation: concrete next step before relying on the answer.",
    "- Do not invent authority or citations.",
  ].join("\n");
}

function buildNarrativeIssuePrompt(label: "GPT" | "CLAUDE") {
  return [
    `You are ${label}, acting as an issue-level tax adjudicator.`,
    "You must adjudicate issue by issue, but the final result must read like one integrated professional tax answer.",
    "You are not writing a model comparison.",
    "",
    "Instructions:",
    "1. Review the issue matrix.",
    "2. For each issue, determine the legally strongest conclusion.",
    "3. Use issue-level reasoning to build one integrated answer in your own voice.",
    "4. Preserve controlling distinctions by converting them into branch analysis where necessary.",
    "5. Do not describe which provider agreed or disagreed unless absolutely necessary internally; never do so in the user-facing narrative.",
    "6. Be conservative and explicit about missing facts.",
    "",
    "Return STRICT JSON ONLY with these exact keys:",
    "{",
    '  "bottom_line": string,',
    '  "technical_analysis": string,',
    '  "branch_analysis": string[],',
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
    '  "key_risks": string[],',
    '  "missing_facts": string[],',
    '  "practical_recommendation": string,',
    '  "confidence": "low" | "medium" | "high"',
    "}",
    "",
    "Important:",
    "- technical_analysis must sound like a tax memo answer, not an adjudication report.",
    "- branch_analysis should contain fact-pattern-dependent outcomes only.",
    "- issue_results exist for internal support, but the narrative must stand on its own.",
    "- Do not invent authority or citations.",
  ].join("\n");
}

function buildNarrativeMergerPrompt() {
  return [
    "You are the final merger model for a tax adjudication engine.",
    "You are receiving:",
    "1. the issue matrix,",
    "2. a GPT issue-level adjudication, and",
    "3. a Claude issue-level adjudication.",
    "",
    "Your job is to produce the safest final professional tax answer.",
    "Do NOT write a comparison of the adjudications.",
    "Do NOT mention agreement/disagreement between the adjudicators.",
    "Resolve the conflicts yourself and present one integrated legal answer.",
    "",
    "Rules:",
    "1. Preserve legally controlling distinctions.",
    "2. Where the legal outcome changes by facts, present branch analysis.",
    "3. Avoid meta-language such as 'some models' or 'one adjudicator'.",
    "4. Prefer legal precision over smooth but over-broad summary.",
    "5. Do not invent authority or citations.",
    "",
    "Return STRICT JSON ONLY with these exact keys:",
    "{",
    '  "bottom_line": string,',
    '  "technical_analysis": string,',
    '  "branch_analysis": string[],',
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
    '  "key_risks": string[],',
    '  "missing_facts": string[],',
    '  "practical_recommendation": string,',
    '  "confidence": "low" | "medium" | "high"',
    "}",
  ].join("\n");
}

async function adjudicateNarrativeWithOpenAI(
  input: CrosscheckInput,
  outputs: ProviderOutput[]
): Promise<NormalizedNarrativeConsensus | null> {
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
    "Provider outputs:",
    packed,
  ]
    .filter(Boolean)
    .join("\n\n");

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      { role: "system", content: buildNarrativeAdjudicationPrompt("GPT") },
      { role: "user", content: user },
    ],
    max_tokens: clampInt((input as any)?.maxTokens, 700, 2400, 1700),
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";
  const extracted = extractJsonObject(raw);
  const parsed = safeJsonParse<NarrativeAdjudicationJson>(extracted);

  if (!parsed) return null;
  return normalizeNarrativeConsensus(parsed);
}

async function adjudicateNarrativeWithClaude(
  input: CrosscheckInput,
  outputs: ProviderOutput[]
): Promise<NormalizedNarrativeConsensus | null> {
  const packed = packProviderOutputs(outputs);

  const prompt = [
    input.jurisdiction ? `Jurisdiction: ${input.jurisdiction}` : "",
    input.constraints ? `Constraints: ${input.constraints}` : "",
    input.facts ? `Facts:\n${input.facts}` : "",
    `Question:\n${input.question}`,
    "",
    "Provider outputs:",
    packed,
    "",
    buildNarrativeAdjudicationPrompt("CLAUDE"),
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await callAnthropic({
    ...input,
    question: prompt,
    maxTokens: clampInt((input as any)?.maxTokens, 700, 3200, 1800),
  });

  if (result.status !== "ok" || !result.text) return null;

  const extracted = extractJsonObject(result.text);
  const parsed = safeJsonParse<NarrativeAdjudicationJson>(extracted);

  if (!parsed) return null;
  return normalizeNarrativeConsensus(parsed);
}

async function adjudicateNarrativeIssueMatrixWithOpenAI(args: {
  input: CrosscheckInput;
  matrix: IssueMatrix;
}): Promise<NormalizedNarrativeConsensus | null> {
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
      { role: "system", content: buildNarrativeIssuePrompt("GPT") },
      { role: "user", content: user },
    ],
    max_tokens: clampInt((args.input as any)?.maxTokens, 900, 2800, 1900),
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";
  const extracted = extractJsonObject(raw);
  const parsed = safeJsonParse<NarrativeIssueAdjudicationJson>(extracted);

  if (!parsed) return null;

  return normalizeNarrativeConsensus({
    bottom_line: parsed.bottom_line,
    technical_analysis: parsed.technical_analysis,
    branch_analysis: parsed.branch_analysis,
    key_risks: parsed.key_risks,
    missing_facts: uniq([
      ...normalizeStringArray(parsed.missing_facts),
      ...((Array.isArray(parsed.issue_results) ? parsed.issue_results : []).flatMap((x) =>
        normalizeStringArray(x?.missing_facts)
      )),
    ]),
    practical_recommendation: parsed.practical_recommendation,
    confidence: parsed.confidence,
  });
}

async function adjudicateNarrativeIssueMatrixWithClaude(args: {
  input: CrosscheckInput;
  matrix: IssueMatrix;
}): Promise<NormalizedNarrativeConsensus | null> {
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
    buildNarrativeIssuePrompt("CLAUDE"),
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
  const parsed = safeJsonParse<NarrativeIssueAdjudicationJson>(extracted);

  if (!parsed) return null;

  return normalizeNarrativeConsensus({
    bottom_line: parsed.bottom_line,
    technical_analysis: parsed.technical_analysis,
    branch_analysis: parsed.branch_analysis,
    key_risks: parsed.key_risks,
    missing_facts: uniq([
      ...normalizeStringArray(parsed.missing_facts),
      ...((Array.isArray(parsed.issue_results) ? parsed.issue_results : []).flatMap((x) =>
        normalizeStringArray(x?.missing_facts)
      )),
    ]),
    practical_recommendation: parsed.practical_recommendation,
    confidence: parsed.confidence,
  });
}

async function mergeNarrativeIssueAdjudicationsWithOpenAI(args: {
  input: CrosscheckInput;
  matrix: IssueMatrix;
  gpt: NormalizedNarrativeConsensus | null;
  claude: NormalizedNarrativeConsensus | null;
}): Promise<NormalizedNarrativeConsensus | null> {
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
      { role: "system", content: buildNarrativeMergerPrompt() },
      { role: "user", content: user },
    ],
    max_tokens: 2300,
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";
  const extracted = extractJsonObject(raw);
  const parsed = safeJsonParse<NarrativeIssueAdjudicationJson>(extracted);

  if (!parsed) return args.gpt || args.claude || null;

  return normalizeNarrativeConsensus({
    bottom_line: parsed.bottom_line,
    technical_analysis: parsed.technical_analysis,
    branch_analysis: parsed.branch_analysis,
    key_risks: parsed.key_risks,
    missing_facts: uniq([
      ...normalizeStringArray(parsed.missing_facts),
      ...((Array.isArray(parsed.issue_results) ? parsed.issue_results : []).flatMap((x) =>
        normalizeStringArray(x?.missing_facts)
      )),
    ]),
    practical_recommendation: parsed.practical_recommendation,
    confidence: parsed.confidence,
  });
}

async function mergeNarrativeAdjudicationsWithOpenAI(args: {
  input: CrosscheckInput;
  providerOutputs: ProviderOutput[];
  gpt: NormalizedNarrativeConsensus | null;
  claude: NormalizedNarrativeConsensus | null;
}): Promise<NormalizedNarrativeConsensus | null> {
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
    "You are receiving raw provider outputs and two adjudications.",
    "Produce the safest, most conservative final professional tax answer.",
    "Do NOT write a comparison of the adjudications.",
    "Do NOT use headings or language such as common ground, differences in emphasis, minority view, or one model said.",
    "Resolve conflicts yourself and present one integrated tax answer in your own voice.",
    "Where different legal outcomes apply to different fact patterns, present branch analysis.",
    "Prefer legal precision over smooth but over-broad summary.",
    "Do not invent authority or citations.",
    "",
    "Return STRICT JSON ONLY with these exact keys:",
    "{",
    '  "bottom_line": string,',
    '  "technical_analysis": string,',
    '  "branch_analysis": string[],',
    '  "key_risks": string[],',
    '  "missing_facts": string[],',
    '  "practical_recommendation": string,',
    '  "confidence": "low" | "medium" | "high"',
    "}",
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
    max_tokens: 1800,
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";
  const extracted = extractJsonObject(raw);
  const parsed = safeJsonParse<NarrativeAdjudicationJson>(extracted);

  if (!parsed) return args.gpt || args.claude || null;
  return normalizeNarrativeConsensus(parsed);
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

  let finalNarrative: NormalizedNarrativeConsensus | null = null;

  if (succeededCalls.length >= 2) {
    const matrix = buildIssueMatrix(input, providers);

    if (dualAdjudicatorEnabled()) {
      const [gptIssueAdj, claudeIssueAdj] = await Promise.all([
        adjudicateNarrativeIssueMatrixWithOpenAI({ input, matrix }).catch(() => null),
        adjudicateNarrativeIssueMatrixWithClaude({ input, matrix }).catch(() => null),
      ]);

      finalNarrative = await mergeNarrativeIssueAdjudicationsWithOpenAI({
        input,
        matrix,
        gpt: gptIssueAdj,
        claude: claudeIssueAdj,
      }).catch(() => gptIssueAdj || claudeIssueAdj || null);
    } else {
      finalNarrative = await adjudicateNarrativeIssueMatrixWithOpenAI({
        input,
        matrix,
      }).catch(() => null);
    }
  }

  if (!finalNarrative) {
    if (dualAdjudicatorEnabled()) {
      const [gptAdj, claudeAdj] = await Promise.all([
        adjudicateNarrativeWithOpenAI(input, providers).catch(() => null),
        adjudicateNarrativeWithClaude(input, providers).catch(() => null),
      ]);

      finalNarrative = await mergeNarrativeAdjudicationsWithOpenAI({
        input,
        providerOutputs: providers,
        gpt: gptAdj,
        claude: claudeAdj,
      }).catch(() => gptAdj || claudeAdj || null);
    } else {
      finalNarrative = await adjudicateNarrativeWithOpenAI(input, providers).catch(() => null);
    }
  }

  const answer =
    finalNarrative?.answer ||
    best?.text?.trim() ||
    `I couldn't get a successful provider response yet. Providers attempted: ${attempted
      .map((a) => `${a.provider}:${a.model}`)
      .join(", ")}`;

  const caveats = uniq([
    ...(finalNarrative?.key_risks || []),
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

  const followups = uniq(finalNarrative?.missing_facts || []);
  const disagreements: string[] = [];

  const confidence =
    finalNarrative?.confidence ||
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
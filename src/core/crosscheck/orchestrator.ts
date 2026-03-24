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
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, rej) => {
    t = setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms);
  });
  return Promise.race([
    p.finally(() => {
      if (t) clearTimeout(t);
    }),
    timeout,
  ]);
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

function providerCoreThreshold(): number {
  return clampInt(env("CROSSCHECK_PROVIDER_MIN_SCORE"), 0, 1000, 240);
}

function providerSupportThreshold(): number {
  return clampInt(env("CROSSCHECK_PROVIDER_SUPPORT_SCORE"), 0, 1000, 150);
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

function normalizeText(s: string): string {
  return String(s || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(s: string, max = 1200): string {
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

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniq(value.map(String));
}

function confidenceOrLow(value: unknown): "low" | "medium" | "high" {
  const v = String(value || "").toLowerCase();
  if (v === "high" || v === "medium" || v === "low") return v;
  return "low";
}

type MemoJson = {
  executive_summary?: string;
  analysis?: string;
  transaction_specific_treatment?: string[];
  required_confirmations?: string[];
  recommendation?: string;
  confidence?: "low" | "medium" | "high" | string;
};

type ProviderClaimJson = {
  statement?: string;
  topic?: string;
  controlling?: boolean;
  confidence?: "low" | "medium" | "high" | string;
  applies_to?: string[] | string;
};

type ProviderMemoJson = MemoJson & {
  claims?: ProviderClaimJson[];
};

type ProviderConflictResponseJson = {
  claim_id?: string;
  action?: "maintain" | "revise" | "withdraw" | string;
  explanation?: string;
  revised_statement?: string;
};

type ProviderRevisionJson = ProviderMemoJson & {
  responses_to_disputed_claims?: ProviderConflictResponseJson[];
};

type NormalizedClaim = {
  statement: string;
  topic: string;
  controlling: boolean;
  confidence: "low" | "medium" | "high";
  applies_to: string[];
};

type NormalizedMemo = {
  executive_summary: string;
  analysis: string;
  transaction_specific_treatment: string[];
  required_confirmations: string[];
  recommendation: string;
  confidence: "low" | "medium" | "high";
  claims: NormalizedClaim[];
  answer: string;
};

type ProviderMemoArtifact = {
  provider: ProviderOutput["provider"];
  model: string;
  round: 1 | 2;
  memo: NormalizedMemo;
  rawText: string;
  ms: number;
};

type ProviderAssessment = {
  provider: ProviderOutput["provider"];
  model: string;
  score: number;
  tier: "core" | "supporting" | "excluded" | "failed";
  reasons: string[];
};

type ConflictPositionJson = {
  provider?: string;
  model?: string;
  position?: string;
  confidence?: "low" | "medium" | "high" | string;
};

type DisputedClaimJson = {
  claim_id?: string;
  claim_statement?: string;
  why_controlling?: string;
  provider_positions?: ConflictPositionJson[];
  challenge_prompt?: string;
};

type ConflictMatrixJson = {
  common_claims?: string[];
  disputed_claims?: DisputedClaimJson[];
  missing_or_underdeveloped_issues?: string[];
};

type ConflictPosition = {
  provider: string;
  model: string;
  position: string;
  confidence: "low" | "medium" | "high";
};

type DisputedClaim = {
  claim_id: string;
  claim_statement: string;
  why_controlling: string;
  provider_positions: ConflictPosition[];
  challenge_prompt: string;
};

type ConflictMatrix = {
  common_claims: string[];
  disputed_claims: DisputedClaim[];
  missing_or_underdeveloped_issues: string[];
};

type StructuralValidation = {
  valid: boolean;
  issues: string[];
  penalty: number;
  dimensionsCovered: string[];
};

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
    .replace(/\bongoing litigation\b[^.]*\./gi, "")
    .replace(/\belectronic invoic(?:e|ing)\b[^.]*\./gi, "")
    .replace(/\bnf-e\b[^.]*\./gi, "")
    .replace(/\bgnre\b[^.]*\./gi, "")
    .replace(/\bcfop\b[^.]*\./gi, "")
    .replace(/\bfci\b[^.]*\./gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanArray(values: string[]): string[] {
  return uniq(
    values
      .map(cleanMemoText)
      .map((x) => x.replace(/^[•\-]\s*/, "").trim())
      .filter(Boolean)
      .filter((x) => x.length > 6)
  );
}

function buildMemoAnswer(parsed: Omit<NormalizedMemo, "answer" | "claims">): string {
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

function normalizeClaims(claims: unknown): NormalizedClaim[] {
  if (!Array.isArray(claims)) return [];

  return uniq(
    claims
      .map((c) => {
        const claim = c as ProviderClaimJson;
        const statement = cleanMemoText(String(claim?.statement || "").trim());
        const topic = String(claim?.topic || "").trim() || "general";
        const controlling = Boolean(claim?.controlling);
        const confidence = confidenceOrLow(claim?.confidence);
        const appliesRaw = Array.isArray(claim?.applies_to)
          ? claim.applies_to
          : typeof claim?.applies_to === "string"
          ? [claim.applies_to]
          : [];
        const applies_to = cleanArray(appliesRaw.map(String));

        if (!statement) return null;
        return {
          statement,
          topic,
          controlling,
          confidence,
          applies_to,
        } satisfies NormalizedClaim;
      })
      .filter(Boolean)
      .map((x) => JSON.stringify(x))
  ).map((x) => JSON.parse(x) as NormalizedClaim);
}

function heuristicClaimExtraction(text: string): NormalizedClaim[] {
  const snippets = splitIntoSnippets(text);
  const keywordPatterns: Array<{ topic: string; regex: RegExp; controlling?: boolean }> = [
    { topic: "governing_tax", regex: /\btax\b|\bvat\b|\bgst\b|\bicms\b|\bwithholding\b|\biss\b|\bipi\b/i, controlling: true },
    { topic: "buyer_status", regex: /\bbuyer\b|\bcustomer\b|\bconsumer\b|\btaxpayer\b|\bnon-taxpayer\b|\bcontributor\b|\bnon-contributor\b/i, controlling: true },
    { topic: "transaction_purpose", regex: /\bresale\b|\bindustrialization\b|\bown use\b|\bfixed asset\b|\bconsumption\b|\bpurpose\b/i, controlling: true },
    { topic: "transaction_type", regex: /\bgoods\b|\bservices\b|\bintangibles?\b|\bdigital\b/i, controlling: true },
    { topic: "geography", regex: /\binterstate\b|\bcross-border\b|\borigin\b|\bdestination\b|\bstate\b|\bcountry\b/i, controlling: true },
    { topic: "rate_mechanics", regex: /\brate\b|\b7%\b|\b12%\b|\b4%\b|\bdifal\b|\bdifferential\b|\bcredit\b/i, controlling: true },
    { topic: "special_regime", regex: /\bst\b|\bsubstitui\b|\bexempt\b|\bdeferr/i, controlling: false },
  ];

  const claims: NormalizedClaim[] = [];
  for (const s of snippets) {
    for (const p of keywordPatterns) {
      if (p.regex.test(s)) {
        claims.push({
          statement: cleanMemoText(s),
          topic: p.topic,
          controlling: Boolean(p.controlling),
          confidence: "low",
          applies_to: [],
        });
        break;
      }
    }
  }

  return uniq(claims.map((x) => JSON.stringify(x))).map((x) =>
    JSON.parse(x) as NormalizedClaim
  );
}

function normalizeMemoJson(parsed: ProviderMemoJson): NormalizedMemo {
  const memoNoAnswer = {
    executive_summary: cleanMemoText(String(parsed?.executive_summary || "").trim()),
    analysis: cleanMemoText(String(parsed?.analysis || "").trim()),
    transaction_specific_treatment: cleanArray(
      normalizeStringArray(parsed?.transaction_specific_treatment)
    ),
    required_confirmations: cleanArray(
      normalizeStringArray(parsed?.required_confirmations)
    ),
    recommendation: cleanMemoText(String(parsed?.recommendation || "").trim()),
    confidence: confidenceOrLow(parsed?.confidence),
    claims: normalizeClaims(parsed?.claims),
  };

  const answer = buildMemoAnswer({
    executive_summary: memoNoAnswer.executive_summary,
    analysis: memoNoAnswer.analysis,
    transaction_specific_treatment: memoNoAnswer.transaction_specific_treatment,
    required_confirmations: memoNoAnswer.required_confirmations,
    recommendation: memoNoAnswer.recommendation,
    confidence: memoNoAnswer.confidence,
  });

  return {
    ...memoNoAnswer,
    claims: memoNoAnswer.claims.length
      ? memoNoAnswer.claims
      : heuristicClaimExtraction(answer),
    answer,
  };
}

function parseProviderMemo(rawText: string): NormalizedMemo {
  const extracted = extractJsonObject(rawText);
  const parsed = safeJsonParse<ProviderMemoJson>(extracted);

  if (parsed) return normalizeMemoJson(parsed);

  const cleaned = cleanMemoText(rawText);
  const snippets = splitIntoSnippets(cleaned);
  const executive_summary = snippets[0] || truncate(cleaned, 300);

  return normalizeMemoJson({
    executive_summary,
    analysis: cleaned,
    transaction_specific_treatment: [],
    required_confirmations: [],
    recommendation: "",
    claims: heuristicClaimExtraction(cleaned),
    confidence: "low",
  });
}

function normalizeConflictMatrix(parsed: ConflictMatrixJson | null): ConflictMatrix {
  if (!parsed) {
    return {
      common_claims: [],
      disputed_claims: [],
      missing_or_underdeveloped_issues: [],
    };
  }

  const disputed_claims: DisputedClaim[] = Array.isArray(parsed.disputed_claims)
    ? parsed.disputed_claims
        .map((d, idx) => {
          const provider_positions: ConflictPosition[] = Array.isArray(d?.provider_positions)
            ? d.provider_positions
                .map((p) => ({
                  provider: String(p?.provider || "").trim(),
                  model: String(p?.model || "").trim(),
                  position: cleanMemoText(String(p?.position || "").trim()),
                  confidence: confidenceOrLow(p?.confidence),
                }))
                .filter((x) => x.provider && x.position)
            : [];

          const claim_statement = cleanMemoText(
            String(d?.claim_statement || "").trim()
          );
          if (!claim_statement) return null;

          return {
            claim_id: String(d?.claim_id || `disputed_${idx + 1}`),
            claim_statement,
            why_controlling: cleanMemoText(String(d?.why_controlling || "").trim()),
            provider_positions,
            challenge_prompt: cleanMemoText(String(d?.challenge_prompt || "").trim()),
          } satisfies DisputedClaim;
        })
        .filter(Boolean) as DisputedClaim[]
    : [];

  return {
    common_claims: cleanArray(normalizeStringArray(parsed.common_claims)),
    disputed_claims,
    missing_or_underdeveloped_issues: cleanArray(
      normalizeStringArray(parsed.missing_or_underdeveloped_issues)
    ),
  };
}

function serializeProviderArtifacts(artifacts: ProviderMemoArtifact[]): string {
  return JSON.stringify(
    artifacts.map((a) => ({
      provider: a.provider,
      model: a.model,
      round: a.round,
      memo: {
        executive_summary: a.memo.executive_summary,
        analysis: truncate(a.memo.analysis, 1800),
        transaction_specific_treatment: a.memo.transaction_specific_treatment,
        required_confirmations: a.memo.required_confirmations,
        recommendation: a.memo.recommendation,
        confidence: a.memo.confidence,
      },
      claims: a.memo.claims,
    })),
    null,
    2
  );
}

function serializeAssessments(assessments: ProviderAssessment[]): string {
  return JSON.stringify(assessments, null, 2);
}

function serializeConflictMatrix(matrix: ConflictMatrix): string {
  return JSON.stringify(matrix, null, 2);
}

function inferExpectedDimensions(input: CrosscheckInput): string[] {
  const hay = `${input.question || ""}\n${input.facts || ""}\n${input.constraints || ""}\n${input.jurisdiction || ""}`.toLowerCase();
  const out: string[] = [];

  if (
    hay.includes("buyer") ||
    hay.includes("customer") ||
    hay.includes("consumer") ||
    hay.includes("taxpayer") ||
    hay.includes("b2b") ||
    hay.includes("b2c")
  ) {
    out.push("buyer_status");
  }

  if (
    hay.includes("resale") ||
    hay.includes("own use") ||
    hay.includes("fixed asset") ||
    hay.includes("consumption") ||
    hay.includes("industrialization") ||
    hay.includes("purpose")
  ) {
    out.push("transaction_purpose");
  }

  if (
    hay.includes("goods") ||
    hay.includes("services") ||
    hay.includes("intangibles") ||
    hay.includes("digital")
  ) {
    out.push("transaction_type");
  }

  if (
    hay.includes("interstate") ||
    hay.includes("cross-border") ||
    hay.includes("between states") ||
    hay.includes("origin") ||
    hay.includes("destination") ||
    hay.includes("country")
  ) {
    out.push("geography");
  }

  if (
    hay.includes("product") ||
    hay.includes("classification") ||
    hay.includes("ncm") ||
    hay.includes("import")
  ) {
    out.push("product_or_special_regime");
  }

  return uniq(out);
}

function validateStructuralCompleteness(
  input: CrosscheckInput,
  memo: NormalizedMemo
): StructuralValidation {
  const expected = inferExpectedDimensions(input);
  if (!expected.length) {
    return {
      valid: true,
      issues: [],
      penalty: 0,
      dimensionsCovered: [],
    };
  }

  const text =
    `${memo.executive_summary}\n${memo.analysis}\n${memo.transaction_specific_treatment.join("\n")}\n${memo.required_confirmations.join("\n")}`.toLowerCase();

  const issues: string[] = [];
  const dimensionsCovered: string[] = [];
  let penalty = 0;

  const has = {
    buyer_status:
      /\bbuyer\b|\bcustomer\b|\bconsumer\b|\btaxpayer\b|\bnon-taxpayer\b|\bcontributor\b|\bfinal consumer\b/i.test(text),
    transaction_purpose:
      /\bresale\b|\bown use\b|\bfixed asset\b|\bconsumption\b|\bindustrialization\b|\bpurpose\b/i.test(text),
    transaction_type:
      /\bgoods\b|\bservices\b|\bintangibles?\b|\bdigital\b/i.test(text),
    geography:
      /\binterstate\b|\bcross-border\b|\borigin\b|\bdestination\b|\bstate\b|\bcountry\b/i.test(text),
    product_or_special_regime:
      /\bproduct\b|\bclassification\b|\bncm\b|\bimport\b|\bspecial regime\b|\bsubstitui\b|\bexempt\b/i.test(text),
  };

  for (const dim of expected) {
    if (has[dim as keyof typeof has]) {
      dimensionsCovered.push(dim);
    } else {
      issues.push(`Missing coverage for expected dimension: ${dim.replace(/_/g, " ")}.`);
      penalty += 70;
    }
  }

  if (expected.length >= 2 && memo.transaction_specific_treatment.length === 0) {
    issues.push("Missing transaction-specific treatment despite multi-branch question.");
    penalty += 100;
  }

  if (!memo.required_confirmations.length) {
    issues.push("Missing required confirmations.");
    penalty += 40;
  }

  const controllingClaimCount = memo.claims.filter((c) => c.controlling).length;
  if (controllingClaimCount < 2) {
    issues.push("Insufficient controlling claims extracted.");
    penalty += 60;
  }

  return {
    valid: penalty === 0,
    issues,
    penalty,
    dimensionsCovered,
  };
}

function buildProviderWorkPrompt(input: CrosscheckInput, providerLabel: string): string {
  return [
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
    "1. Classify the transaction.",
    "2. Identify the controlling variables.",
    "3. Identify what actually changes the legal outcome.",
    "4. Exclude non-essential topics.",
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
    "STRICT JSON OUTPUT",
    "{",
    '  "executive_summary": string,',
    '  "analysis": string,',
    '  "transaction_specific_treatment": string[],',
    '  "required_confirmations": string[],',
    '  "recommendation": string,',
    '  "claims": [',
    "    {",
    '      "statement": string,',
    '      "topic": string,',
    '      "controlling": boolean,',
    '      "confidence": "low" | "medium" | "high",',
    '      "applies_to": string[]',
    "    }",
    "  ],",
    '  "confidence": "low" | "medium" | "high"',
    "}",
    "",
    "CLAIMS RULES",
    "- Include 5 to 12 claims.",
    "- Each claim must be one concrete legal proposition.",
    "- Claims should capture controlling mechanics, not narrative fluff.",
    "- Include claims for material branches where treatment changes.",
    "",
    "STYLE RULES",
    "- Sound like a tax professional, not an AI.",
    "- Be concise and controlled.",
    "- Avoid 'generally', 'typically', unless necessary.",
    "- Do not recommend consulting authorities.",
    "- Do not include penalties or scare language.",
    "- Do not invent authority or citations.",
    "",
    input.jurisdiction ? `Jurisdiction: ${input.jurisdiction}` : "",
    input.constraints ? `Constraints:\n${input.constraints}` : "",
    input.facts ? `Facts:\n${input.facts}` : "",
    `Question:\n${input.question}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildChallengePrompt(args: {
  input: CrosscheckInput;
  providerLabel: string;
  originalMemo: ProviderMemoArtifact;
  conflictMatrix: ConflictMatrix;
  assessment?: ProviderAssessment;
}): string {
  return [
    `You are ${args.providerLabel}, revising your tax memo after a cross-model conflict review.`,
    "You must confront the disputed claims directly.",
    "Do NOT ignore the conflict matrix.",
    "For each disputed claim, choose one action:",
    "- maintain",
    "- revise",
    "- withdraw",
    "",
    "If you revise or withdraw, explain why and update your memo accordingly.",
    "If you maintain, defend the position clearly and narrowly.",
    "",
    "Your revised answer must still be an internal tax memo.",
    "Do not mention other models in the final memo text.",
    "",
    "STRICT JSON OUTPUT",
    "{",
    '  "executive_summary": string,',
    '  "analysis": string,',
    '  "transaction_specific_treatment": string[],',
    '  "required_confirmations": string[],',
    '  "recommendation": string,',
    '  "claims": [',
    "    {",
    '      "statement": string,',
    '      "topic": string,',
    '      "controlling": boolean,',
    '      "confidence": "low" | "medium" | "high",',
    '      "applies_to": string[]',
    "    }",
    "  ],",
    '  "responses_to_disputed_claims": [',
    "    {",
    '      "claim_id": string,',
    '      "action": "maintain" | "revise" | "withdraw",',
    '      "explanation": string,',
    '      "revised_statement": string',
    "    }",
    "  ],",
    '  "confidence": "low" | "medium" | "high"',
    "}",
    "",
    args.input.jurisdiction ? `Jurisdiction: ${args.input.jurisdiction}` : "",
    args.input.constraints ? `Constraints:\n${args.input.constraints}` : "",
    args.input.facts ? `Facts:\n${args.input.facts}` : "",
    `Question:\n${args.input.question}`,
    "",
    "Your original memo and claims:",
    JSON.stringify(
      {
        memo: {
          executive_summary: args.originalMemo.memo.executive_summary,
          analysis: args.originalMemo.memo.analysis,
          transaction_specific_treatment:
            args.originalMemo.memo.transaction_specific_treatment,
          required_confirmations: args.originalMemo.memo.required_confirmations,
          recommendation: args.originalMemo.memo.recommendation,
          confidence: args.originalMemo.memo.confidence,
        },
        claims: args.originalMemo.memo.claims,
      },
      null,
      2
    ),
    "",
    args.assessment
      ? `Your provider quality assessment:\n${JSON.stringify(args.assessment, null, 2)}`
      : "",
    "",
    "Conflict matrix to address:",
    serializeConflictMatrix(args.conflictMatrix),
  ]
    .filter(Boolean)
    .join("\n\n");
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
  return bonuses.filter((x) => t.includes(x)).length * 50;
}

function genericityPenalty(text: string): number {
  const t = text.toLowerCase();
  const penaltyTerms = [
    "state-specific rules create complexity",
    "consult local tax",
    "consult a professional",
    "seek local counsel",
    "contact tax authorities",
    "ongoing litigation",
    "tax reform",
    "nf-e",
    "gnre",
    "cfop",
    "pis/cofins",
    "ipi",
    "electronic invoicing",
    "supreme federal court",
  ];
  return penaltyTerms.filter((x) => t.includes(x)).length * 80;
}

function overgeneralizationPenalty(text: string): number {
  const t = text.toLowerCase();
  const badPatterns = [
    "all transactions",
    "all sales",
    "all interstate sales",
    "always applies",
    "never applies",
    "only the interstate rate applies",
    "interstate sales are subject to",
  ];
  return badPatterns.filter((x) => t.includes(x)).length * 120;
}

function providerAssessmentForArtifact(
  artifact: ProviderMemoArtifact,
  input?: CrosscheckInput
): ProviderAssessment {
  const text = artifact.memo.answer.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  score += Math.min(artifact.memo.answer.length, 2400) / 20;
  score += memoQualityBonus(artifact.memo.answer);
  score -= genericityPenalty(artifact.memo.answer);
  score -= overgeneralizationPenalty(artifact.memo.answer);

  if (artifact.memo.claims.length >= 5) {
    score += 80;
    reasons.push("structured claim set");
  } else if (artifact.memo.claims.length > 0) {
    score += 20;
    reasons.push("partial claim set");
  } else {
    reasons.push("missing structured claims");
  }

  if (artifact.memo.transaction_specific_treatment.length >= 2) {
    score += 90;
    reasons.push("good transaction-specific treatment");
  } else if (artifact.memo.transaction_specific_treatment.length === 1) {
    score += 30;
    reasons.push("limited transaction-specific treatment");
  } else {
    reasons.push("missing transaction-specific treatment");
  }

  if (artifact.memo.claims.some((c) => c.controlling)) {
    score += 70;
    reasons.push("identifies controlling distinctions");
  } else {
    reasons.push("weak prioritization of controlling distinctions");
  }

  if (text.includes("vat") || text.includes("tax") || text.includes("withholding") || text.includes("icms")) {
    score += 40;
    reasons.push("addresses governing tax regime");
  }

  if (input) {
    const structural = validateStructuralCompleteness(input, artifact.memo);
    if (structural.valid) {
      score += 100;
      reasons.push("structural completeness validated");
    } else {
      score -= structural.penalty;
      reasons.push(...structural.issues);
    }

    if (structural.dimensionsCovered.length) {
      reasons.push(
        `covered dimensions: ${structural.dimensionsCovered.join("; ")}`
      );
    }
  }

  let tier: ProviderAssessment["tier"] = "excluded";
  if (score >= providerCoreThreshold()) tier = "core";
  else if (score >= providerSupportThreshold()) tier = "supporting";

  return {
    provider: artifact.provider,
    model: artifact.model,
    score: Math.round(score),
    tier,
    reasons: uniq(reasons),
  };
}

function chooseArtifactsForReasoning(
  artifacts: ProviderMemoArtifact[],
  assessments: ProviderAssessment[]
): ProviderMemoArtifact[] {
  const scoreMap = new Map(
    assessments.map((a) => [`${a.provider}::${a.model}`, a] as const)
  );

  const ordered = [...artifacts].sort((a, b) => {
    const aa = scoreMap.get(`${a.provider}::${a.model}`)?.score ?? 0;
    const bb = scoreMap.get(`${b.provider}::${b.model}`)?.score ?? 0;
    return bb - aa;
  });

  const core = ordered.filter((a) => {
    const s = scoreMap.get(`${a.provider}::${a.model}`);
    return s?.tier === "core";
  });
  if (core.length >= 2) return core.slice(0, 4);

  const supportOrCore = ordered.filter((a) => {
    const s = scoreMap.get(`${a.provider}::${a.model}`);
    return s?.tier === "core" || s?.tier === "supporting";
  });
  if (supportOrCore.length >= 2) return supportOrCore.slice(0, 4);

  return ordered.slice(0, Math.min(3, ordered.length));
}

function pickBestArtifact(
  artifacts: ProviderMemoArtifact[],
  assessments: ProviderAssessment[]
): ProviderMemoArtifact | null {
  if (!artifacts.length) return null;

  const assessmentMap = new Map(
    assessments.map((a) => [`${a.provider}::${a.model}`, a.score] as const)
  );

  const scored = artifacts.map((a) => {
    const score =
      (assessmentMap.get(`${a.provider}::${a.model}`) ?? 0) +
      memoQualityBonus(a.memo.answer) -
      genericityPenalty(a.memo.answer) -
      overgeneralizationPenalty(a.memo.answer);

    return { artifact: a, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.artifact ?? null;
}

function mergeConflictMatrices(
  a: ConflictMatrix | null,
  b: ConflictMatrix | null
): ConflictMatrix {
  if (!a && !b) {
    return {
      common_claims: [],
      disputed_claims: [],
      missing_or_underdeveloped_issues: [],
    };
  }
  if (!a) return b as ConflictMatrix;
  if (!b) return a;

  const disputed = [...a.disputed_claims, ...b.disputed_claims];
  const seen = new Set<string>();
  const mergedDisputed: DisputedClaim[] = [];

  for (const d of disputed) {
    const key = d.claim_statement.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    mergedDisputed.push(d);
  }

  return {
    common_claims: cleanArray([...a.common_claims, ...b.common_claims]),
    disputed_claims: mergedDisputed,
    missing_or_underdeveloped_issues: cleanArray([
      ...a.missing_or_underdeveloped_issues,
      ...b.missing_or_underdeveloped_issues,
    ]),
  };
}

async function extractConflictMatrixWithOpenAI(args: {
  input: CrosscheckInput;
  artifacts: ProviderMemoArtifact[];
  assessments: ProviderAssessment[];
}): Promise<ConflictMatrix | null> {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) return null;

  const model =
    env("OPENAI_ADJUDICATOR_MODEL") ||
    env("OPENAI_SYNTH_MODEL") ||
    env("OPENAI_MODEL") ||
    "gpt-4.1-mini";

  const client = new OpenAI({ apiKey });

  const sys = [
    "You are extracting a conflict matrix from multiple tax memo answers.",
    "Do NOT write a final memo.",
    "Your job is to identify:",
    "1. common claims",
    "2. disputed claims that materially affect the answer",
    "3. missing or underdeveloped issues",
    "",
    "Focus on legal propositions, not writing style.",
    "Treat only load-bearing conflicts as disputed claims.",
    "Ignore noise and side issues.",
    "",
    "Return STRICT JSON ONLY with these keys:",
    "common_claims, disputed_claims, missing_or_underdeveloped_issues.",
  ].join("\n");

  const user = [
    args.input.jurisdiction ? `Jurisdiction: ${args.input.jurisdiction}` : "",
    args.input.facts ? `Facts:\n${args.input.facts}` : "",
    `Question:\n${args.input.question}`,
    "",
    "Provider assessments:",
    serializeAssessments(args.assessments),
    "",
    "Provider memo artifacts:",
    serializeProviderArtifacts(args.artifacts),
  ]
    .filter(Boolean)
    .join("\n\n");

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.0,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    max_tokens: 1800,
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";
  const extracted = extractJsonObject(raw);
  return normalizeConflictMatrix(safeJsonParse<ConflictMatrixJson>(extracted));
}

async function extractConflictMatrixWithClaude(args: {
  input: CrosscheckInput;
  artifacts: ProviderMemoArtifact[];
  assessments: ProviderAssessment[];
}): Promise<ConflictMatrix | null> {
  const prompt = [
    args.input.jurisdiction ? `Jurisdiction: ${args.input.jurisdiction}` : "",
    args.input.facts ? `Facts:\n${args.input.facts}` : "",
    `Question:\n${args.input.question}`,
    "",
    "Provider assessments:",
    serializeAssessments(args.assessments),
    "",
    "Provider memo artifacts:",
    serializeProviderArtifacts(args.artifacts),
    "",
    "You are extracting a conflict matrix from multiple tax memo answers.",
    "Do NOT write a final memo.",
    "Identify only load-bearing conflicts.",
    "Return STRICT JSON ONLY with keys:",
    "common_claims, disputed_claims, missing_or_underdeveloped_issues.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await callAnthropic({
    ...args.input,
    question: prompt,
    maxTokens: clampInt(args.input.maxTokens, 1000, 3600, 2000),
  });

  if (result.status !== "ok" || !result.text) return null;

  const extracted = extractJsonObject(result.text);
  return normalizeConflictMatrix(safeJsonParse<ConflictMatrixJson>(extracted));
}

async function buildConflictMatrix(args: {
  input: CrosscheckInput;
  artifacts: ProviderMemoArtifact[];
  assessments: ProviderAssessment[];
}): Promise<ConflictMatrix> {
  const [gpt, claude] = await Promise.all([
    extractConflictMatrixWithOpenAI(args).catch(() => null),
    extractConflictMatrixWithClaude(args).catch(() => null),
  ]);

  return mergeConflictMatrices(gpt, claude);
}

async function runProviderRound2(
  artifact: ProviderMemoArtifact,
  input: CrosscheckInput,
  conflictMatrix: ConflictMatrix,
  assessment?: ProviderAssessment
): Promise<ProviderMemoArtifact | null> {
  const providerLabel =
    artifact.provider === "openai"
      ? "OpenAI"
      : artifact.provider === "gemini"
      ? "Gemini"
      : artifact.provider === "anthropic"
      ? "Anthropic"
      : artifact.model;

  const wrappedInput: CrosscheckInput = {
    ...input,
    question: buildChallengePrompt({
      input,
      providerLabel,
      originalMemo: artifact,
      conflictMatrix,
      assessment,
    }),
    maxTokens: clampInt(input.maxTokens, 800, 4000, 2200),
  };

  let result: ProviderOutput | null = null;

  if (artifact.provider === "openai") {
    result = await callOpenAI(wrappedInput).catch(() => null);
  } else if (artifact.provider === "gemini") {
    result = await callGemini(wrappedInput).catch(() => null);
  } else if (artifact.provider === "openrouter") {
    result = await callOpenRouter(wrappedInput, artifact.model).catch(() => null);
  } else if (artifact.provider === "anthropic") {
    result = await callAnthropic(wrappedInput).catch(() => null);
  }

  if (!result || result.status !== "ok" || !result.text) return null;

  const extracted = extractJsonObject(result.text);
  const parsed = safeJsonParse<ProviderRevisionJson>(extracted);
  const memo = parsed ? normalizeMemoJson(parsed) : parseProviderMemo(result.text);

  return {
    provider: artifact.provider,
    model: artifact.model,
    round: 2,
    memo,
    rawText: result.text,
    ms: result.ms,
  };
}

function summarizeAssessmentsForSelection(
  assessments: ProviderAssessment[],
  selected: ProviderMemoArtifact[]
): ProviderAssessment[] {
  const selectedKeys = new Set(
    selected.map((a) => `${a.provider}::${a.model}`)
  );
  return assessments.filter((a) => selectedKeys.has(`${a.provider}::${a.model}`));
}

async function constructCombinedDraftWithOpenAI(args: {
  input: CrosscheckInput;
  artifacts: ProviderMemoArtifact[];
  assessments: ProviderAssessment[];
  conflictMatrix: ConflictMatrix;
}): Promise<NormalizedMemo | null> {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) return null;

  const model =
    env("OPENAI_SYNTH_MODEL") ||
    env("OPENAI_MODEL") ||
    "gpt-4.1-mini";

  const client = new OpenAI({ apiKey });

  const sys = [
    "You are constructing a combined tax memo draft from multiple revised model answers.",
    "You are NOT writing a comparison.",
    "Build one concise internal memo from the strongest surviving claims.",
    "Do not smooth over unresolved controlling conflicts; narrow the answer if necessary.",
    "Do not invent citations or authorities.",
    "Return STRICT JSON ONLY with keys:",
    "executive_summary, analysis, transaction_specific_treatment, required_confirmations, recommendation, confidence",
  ].join("\n");

  const user = [
    args.input.jurisdiction ? `Jurisdiction: ${args.input.jurisdiction}` : "",
    args.input.facts ? `Facts:\n${args.input.facts}` : "",
    args.input.constraints ? `Constraints:\n${args.input.constraints}` : "",
    `Question:\n${args.input.question}`,
    "",
    "Provider assessments:",
    serializeAssessments(args.assessments),
    "",
    "Revised provider artifacts:",
    serializeProviderArtifacts(args.artifacts),
    "",
    "Conflict matrix:",
    serializeConflictMatrix(args.conflictMatrix),
  ]
    .filter(Boolean)
    .join("\n\n");

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.05,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    max_tokens: 1800,
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";
  const extracted = extractJsonObject(raw);
  const parsed = safeJsonParse<MemoJson>(extracted);
  if (!parsed) return null;
  return normalizeMemoJson(parsed);
}

async function adjudicateFinalWithOpenAI(args: {
  input: CrosscheckInput;
  round1: ProviderMemoArtifact[];
  round2: ProviderMemoArtifact[];
  combinedDraft: NormalizedMemo | null;
  assessments: ProviderAssessment[];
  conflictMatrix1: ConflictMatrix;
  conflictMatrix2: ConflictMatrix;
}): Promise<NormalizedMemo | null> {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) return null;

  const model =
    env("OPENAI_ADJUDICATOR_MODEL") ||
    env("OPENAI_SYNTH_MODEL") ||
    env("OPENAI_MODEL") ||
    "gpt-4.1-mini";

  const client = new OpenAI({ apiKey });

  const sys = [
    "You are the final senior tax adjudicator.",
    "You are writing one internal tax memo for a business stakeholder.",
    "You are NOT writing a comparison of model outputs.",
    "You are NOT writing a study note or primer.",
    "",
    "MATERIALS YOU RECEIVE",
    "- Round 1 provider memos",
    "- Round 1 conflict matrix",
    "- Round 2 revised provider memos after challenge-back",
    "- Round 2 conflict matrix",
    "- provider quality assessments",
    "- a combined draft synthesized from the revised record",
    "",
    "DECISION RULES",
    "1. Weight round 2 higher than round 1.",
    "2. Weight providers with better assessments higher.",
    "3. Use the combined draft as a candidate, not as the unquestioned truth.",
    "4. Do NOT smooth over controlling conflicts just to make the memo cleaner.",
    "5. Prefer narrower but more legally precise analysis over broader generic statements.",
    "6. Exclude non-central taxes and side issues unless necessary to avoid a materially incomplete answer.",
    "7. If a controlling issue remains unresolved after round 2, narrow the answer and lower confidence.",
    "",
    "OUTPUT RULES",
    "- Write a concise internal memo.",
    "- Do not mention providers, models, rounds, agreements, or disagreements.",
    "- Do not include penalty scare language or generic disclaimers.",
    "- Do not recommend contacting tax authorities.",
    "- Do not invent citations or authorities.",
    "",
    "Return STRICT JSON ONLY with keys:",
    "executive_summary, analysis, transaction_specific_treatment, required_confirmations, recommendation, confidence",
  ].join("\n");

  const user = [
    args.input.jurisdiction ? `Jurisdiction: ${args.input.jurisdiction}` : "",
    args.input.facts ? `Facts:\n${args.input.facts}` : "",
    args.input.constraints ? `Constraints:\n${args.input.constraints}` : "",
    `Question:\n${args.input.question}`,
    "",
    "Provider assessments:",
    serializeAssessments(args.assessments),
    "",
    "Round 1 provider memos:",
    serializeProviderArtifacts(args.round1),
    "",
    "Round 1 conflict matrix:",
    serializeConflictMatrix(args.conflictMatrix1),
    "",
    "Round 2 revised provider memos:",
    serializeProviderArtifacts(args.round2),
    "",
    "Round 2 conflict matrix:",
    serializeConflictMatrix(args.conflictMatrix2),
    "",
    "Combined draft:",
    JSON.stringify(args.combinedDraft || {}, null, 2),
  ]
    .filter(Boolean)
    .join("\n\n");

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.05,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    max_tokens: 2200,
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";
  const extracted = extractJsonObject(raw);
  const parsed = safeJsonParse<MemoJson>(extracted);
  if (!parsed) return null;
  return normalizeMemoJson(parsed);
}

async function adjudicateFinalWithClaude(args: {
  input: CrosscheckInput;
  round1: ProviderMemoArtifact[];
  round2: ProviderMemoArtifact[];
  combinedDraft: NormalizedMemo | null;
  assessments: ProviderAssessment[];
  conflictMatrix1: ConflictMatrix;
  conflictMatrix2: ConflictMatrix;
}): Promise<NormalizedMemo | null> {
  const prompt = [
    args.input.jurisdiction ? `Jurisdiction: ${args.input.jurisdiction}` : "",
    args.input.facts ? `Facts:\n${args.input.facts}` : "",
    args.input.constraints ? `Constraints:\n${args.input.constraints}` : "",
    `Question:\n${args.input.question}`,
    "",
    "Provider assessments:",
    serializeAssessments(args.assessments),
    "",
    "Round 1 provider memos:",
    serializeProviderArtifacts(args.round1),
    "",
    "Round 1 conflict matrix:",
    serializeConflictMatrix(args.conflictMatrix1),
    "",
    "Round 2 revised provider memos:",
    serializeProviderArtifacts(args.round2),
    "",
    "Round 2 conflict matrix:",
    serializeConflictMatrix(args.conflictMatrix2),
    "",
    "Combined draft:",
    JSON.stringify(args.combinedDraft || {}, null, 2),
    "",
    "You are the final senior tax adjudicator.",
    "Write one internal tax memo for a business stakeholder.",
    "Do NOT write a model comparison.",
    "Weight round 2 higher than round 1.",
    "Use the combined draft as a candidate, not as unquestioned truth.",
    "Prefer legal precision over generic completeness.",
    "Do not smooth away unresolved controlling conflicts; narrow the answer if necessary.",
    "Do not recommend contacting tax authorities.",
    "Do not invent citations.",
    "Return STRICT JSON ONLY with keys:",
    "executive_summary, analysis, transaction_specific_treatment, required_confirmations, recommendation, confidence",
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await callAnthropic({
    ...args.input,
    question: prompt,
    maxTokens: clampInt(args.input.maxTokens, 1000, 3600, 2200),
  });

  if (result.status !== "ok" || !result.text) return null;

  const extracted = extractJsonObject(result.text);
  const parsed = safeJsonParse<MemoJson>(extracted);
  if (!parsed) return null;
  return normalizeMemoJson(parsed);
}

async function mergeFinalMemosWithOpenAI(args: {
  input: CrosscheckInput;
  gpt: NormalizedMemo | null;
  claude: NormalizedMemo | null;
  combinedDraft: NormalizedMemo | null;
  conflictMatrix2: ConflictMatrix;
}): Promise<NormalizedMemo | null> {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) return args.gpt || args.claude || args.combinedDraft || null;

  const model =
    env("OPENAI_MERGER_MODEL") ||
    env("OPENAI_ADJUDICATOR_MODEL") ||
    env("OPENAI_SYNTH_MODEL") ||
    env("OPENAI_MODEL") ||
    "gpt-4.1-mini";

  const client = new OpenAI({ apiKey });

  const sys = [
    "You are the final merger for two adjudicated tax memos.",
    "Write one concise internal tax memo.",
    "Do NOT write a comparison.",
    "Prefer the more legally precise memo where they differ.",
    "Use the combined draft and the round 2 conflict matrix to avoid smoothing over unresolved controlling issues.",
    "Do not invent citations or authorities.",
    "Return STRICT JSON ONLY with keys:",
    "executive_summary, analysis, transaction_specific_treatment, required_confirmations, recommendation, confidence",
  ].join("\n");

  const user = [
    args.input.jurisdiction ? `Jurisdiction: ${args.input.jurisdiction}` : "",
    args.input.facts ? `Facts:\n${args.input.facts}` : "",
    `Question:\n${args.input.question}`,
    "",
    "Combined draft:",
    JSON.stringify(args.combinedDraft || {}, null, 2),
    "",
    "GPT final memo:",
    JSON.stringify(args.gpt || {}, null, 2),
    "",
    "Claude final memo:",
    JSON.stringify(args.claude || {}, null, 2),
    "",
    "Round 2 conflict matrix:",
    serializeConflictMatrix(args.conflictMatrix2),
  ]
    .filter(Boolean)
    .join("\n\n");

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.0,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    max_tokens: 1800,
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";
  const extracted = extractJsonObject(raw);
  const parsed = safeJsonParse<MemoJson>(extracted);
  if (!parsed) return args.gpt || args.claude || args.combinedDraft || null;
  return normalizeMemoJson(parsed);
}

function repackageProviderOutput(
  out: ProviderOutput,
  originalProvider: ProviderOutput["provider"]
): ProviderOutput {
  if (out.status !== "ok" || !out.text) return out;
  return {
    ...out,
    provider: originalProvider,
  };
}

function wrapInputForRound1(
  input: CrosscheckInput,
  providerLabel: string
): CrosscheckInput {
  return {
    ...input,
    question: buildProviderWorkPrompt(input, providerLabel),
    maxTokens: clampInt(input.maxTokens, 800, 4000, 1800),
  };
}

function buildInitialArtifacts(outputs: ProviderOutput[]): ProviderMemoArtifact[] {
  return outputs
    .filter((o) => o.status === "ok" && (o.text || "").trim())
    .map((o) => ({
      provider: o.provider,
      model: o.model,
      round: 1 as const,
      memo: parseProviderMemo(o.text || ""),
      rawText: o.text || "",
      ms: o.ms,
    }));
}

function assessmentMapFor(assessments: ProviderAssessment[]) {
  return new Map(
    assessments.map((a) => [`${a.provider}::${a.model}`, a] as const)
  );
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
      const msg = e?.message ? String(e.message) : String(e);
      const status = msg.toLowerCase().includes("timeout") ? "timeout" : "error";
      return {
        provider: call.provider,
        model: call.model,
        status,
        ms: timeoutMs,
        error: msg,
      } satisfies ProviderOutput;
    });
  };

  const openaiModel = env("OPENAI_MODEL") || "gpt-4.1-mini";
  tasks.push(
    wrap({ provider: "openai", model: openaiModel }, async () => {
      const result = await callOpenAI(wrapInputForRound1(input, "OpenAI"));
      return repackageProviderOutput(result, "openai");
    })
  );

  for (const m of defaultOpenRouterModels()) {
    tasks.push(
      wrap({ provider: "openrouter", model: m }, async () => {
        const result = await callOpenRouter(wrapInputForRound1(input, m), m);
        return repackageProviderOutput(result, "openrouter");
      })
    );
  }

  if (geminiEnabled()) {
    const geminiModel = env("GEMINI_MODEL") || "gemini-2.5-flash";
    tasks.push(
      wrap({ provider: "gemini", model: geminiModel }, async () => {
        const result = await callGemini(wrapInputForRound1(input, "Gemini"));
        return repackageProviderOutput(result, "gemini");
      })
    );
  }

  const providers = await Promise.all(tasks);

  const succeededCalls: ProviderCall[] = [];
  const failedCalls: ProviderCall[] = [];

  for (const p of providers) {
    const call: ProviderCall = { provider: p.provider, model: p.model };
    if (p.status === "ok") succeededCalls.push(call);
    else failedCalls.push(call);
  }

  const round1Artifacts = buildInitialArtifacts(providers);
  const round1Assessments = round1Artifacts.map((a) =>
    providerAssessmentForArtifact(a, input)
  );
  const selectedRound1 = chooseArtifactsForReasoning(round1Artifacts, round1Assessments);
  const selectedAssessments = summarizeAssessmentsForSelection(
    round1Assessments,
    selectedRound1
  );
  const bestArtifact = pickBestArtifact(round1Artifacts, round1Assessments);

  let round1ConflictMatrix: ConflictMatrix = {
    common_claims: [],
    disputed_claims: [],
    missing_or_underdeveloped_issues: [],
  };

  let round2Artifacts: ProviderMemoArtifact[] = [];
  let round2Assessments: ProviderAssessment[] = [];
  let round2ConflictMatrix: ConflictMatrix = {
    common_claims: [],
    disputed_claims: [],
    missing_or_underdeveloped_issues: [],
  };

  if (selectedRound1.length >= 2) {
    round1ConflictMatrix = await buildConflictMatrix({
      input,
      artifacts: selectedRound1,
      assessments: selectedAssessments,
    }).catch(() => ({
      common_claims: [],
      disputed_claims: [],
      missing_or_underdeveloped_issues: [],
    }));

    const assessmentMap = assessmentMapFor(selectedAssessments);

    const revised = await Promise.all(
      selectedRound1.map((artifact) =>
        runProviderRound2(
          artifact,
          input,
          round1ConflictMatrix,
          assessmentMap.get(`${artifact.provider}::${artifact.model}`)
        ).catch(() => null)
      )
    );

    round2Artifacts = revised.filter(Boolean) as ProviderMemoArtifact[];
    round2Assessments = round2Artifacts.map((a) =>
      providerAssessmentForArtifact(a, input)
    );

    if (round2Artifacts.length >= 2) {
      round2ConflictMatrix = await buildConflictMatrix({
        input,
        artifacts: round2Artifacts,
        assessments: round2Assessments,
      }).catch(() => ({
        common_claims: [],
        disputed_claims: [],
        missing_or_underdeveloped_issues: [],
      }));
    }
  }

  const reasoningArtifacts =
    round2Artifacts.length >= 2 ? round2Artifacts : selectedRound1;
  const reasoningAssessments =
    round2Artifacts.length >= 2 ? round2Assessments : selectedAssessments;
  const reasoningConflictMatrix =
    round2Artifacts.length >= 2 ? round2ConflictMatrix : round1ConflictMatrix;

  let combinedDraft: NormalizedMemo | null = null;
  if (reasoningArtifacts.length >= 2) {
    combinedDraft = await constructCombinedDraftWithOpenAI({
      input,
      artifacts: reasoningArtifacts,
      assessments: reasoningAssessments,
      conflictMatrix: reasoningConflictMatrix,
    }).catch(() => null);
  }

  let finalMemo: NormalizedMemo | null = null;

  if (reasoningArtifacts.length >= 2) {
    if (dualAdjudicatorEnabled()) {
      const [gptFinal, claudeFinal] = await Promise.all([
        adjudicateFinalWithOpenAI({
          input,
          round1: selectedRound1,
          round2: reasoningArtifacts,
          combinedDraft,
          assessments: reasoningAssessments,
          conflictMatrix1: round1ConflictMatrix,
          conflictMatrix2: reasoningConflictMatrix,
        }).catch(() => null),
        adjudicateFinalWithClaude({
          input,
          round1: selectedRound1,
          round2: reasoningArtifacts,
          combinedDraft,
          assessments: reasoningAssessments,
          conflictMatrix1: round1ConflictMatrix,
          conflictMatrix2: reasoningConflictMatrix,
        }).catch(() => null),
      ]);

      finalMemo = await mergeFinalMemosWithOpenAI({
        input,
        gpt: gptFinal,
        claude: claudeFinal,
        combinedDraft,
        conflictMatrix2: reasoningConflictMatrix,
      }).catch(() => gptFinal || claudeFinal || combinedDraft || null);
    } else {
      finalMemo = await adjudicateFinalWithOpenAI({
        input,
        round1: selectedRound1,
        round2: reasoningArtifacts,
        combinedDraft,
        assessments: reasoningAssessments,
        conflictMatrix1: round1ConflictMatrix,
        conflictMatrix2: reasoningConflictMatrix,
      }).catch(() => combinedDraft);
    }
  }

  if (!finalMemo && combinedDraft) {
    finalMemo = combinedDraft;
  }

  if (!finalMemo && bestArtifact) {
    finalMemo = bestArtifact.memo;
  }

  const answer =
    finalMemo?.answer ||
    bestArtifact?.memo.answer ||
    `I couldn't get a successful provider response yet. Providers attempted: ${attempted
      .map((a) => `${a.provider}:${a.model}`)
      .join(", ")}`;

  const unresolvedDisagreements = reasoningConflictMatrix.disputed_claims
    .map((d) => d.claim_statement)
    .slice(0, 8);

  const caveats = uniq([
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
    ...(selectedRound1.length < 2 && succeededCalls.length >= 2
      ? [
          "Multiple providers responded, but most were screened out as too generic or low-quality for core adjudication.",
        ]
      : []),
    ...(reasoningConflictMatrix.disputed_claims.length > 0
      ? [
          "Some controlling differences remained unresolved after the challenge-back round; the final answer was narrowed accordingly.",
        ]
      : []),
  ]);

  const followups = uniq(finalMemo?.required_confirmations || []);

  let confidence: "low" | "medium" | "high" =
    finalMemo?.confidence || (selectedRound1.length >= 2 ? "medium" : "low");

  const unresolvedControllingCount = reasoningConflictMatrix.disputed_claims.filter(
    (d) =>
      d.why_controlling ||
      d.provider_positions.some((p) => p.confidence === "high" || p.confidence === "medium")
  ).length;

  if (unresolvedControllingCount >= 2) confidence = "low";
  else if (unresolvedControllingCount === 1 && confidence === "high") confidence = "medium";
  else if (selectedRound1.length < 2) confidence = "low";

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
      disagreements: unresolvedDisagreements,
    },
    providers,
  };
}
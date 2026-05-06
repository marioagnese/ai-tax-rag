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

function uniq(xs: string[]): string[] {
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

  return models.length
    ? models
    : ["anthropic/claude-sonnet-4.6"];
}

function dualAdjudicatorEnabled(): boolean {
  const raw = (env("CROSSCHECK_DUAL_ADJUDICATOR") || "true")
    .trim()
    .toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off";
}

function geminiEnabled(): boolean {
  return (env("GEMINI_ENABLED") || "").trim().toLowerCase() === "true";
}

function providerCoreThreshold(): number {
  return clampInt(env("CROSSCHECK_PROVIDER_MIN_SCORE"), 0, 1000, 320);
}

function providerSupportThreshold(): number {
  return clampInt(env("CROSSCHECK_PROVIDER_SUPPORT_SCORE"), 0, 1000, 200);
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

function memoFieldToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    return value
      .map((item) => memoFieldToText(item))
      .filter(Boolean)
      .join("\n");
  }

  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, val]) => {
        const body = memoFieldToText(val);
        if (!body) return "";
        const label = key.replace(/_/g, " ");
        return `${label}: ${body}`;
      })
      .filter(Boolean)
      .join("\n");
  }

  return String(value || "");
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

  return uniq(
    bulletized
      .split(/\n+|(?<=[.!?;:])\s+(?=[A-Z0-9(])/g)
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((x) => x.length >= 20)
  );
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniq(value.map(memoFieldToText));
}

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
    .replace(
      /\bconsult (?:local )?counsel\b/gi,
      "obtain targeted review where needed"
    )
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

type ProviderRevisionJson = ProviderMemoJson & {
  responses_to_disputed_claims?: Array<{
    claim_id?: string;
    action?: "maintain" | "revise" | "withdraw" | string;
    explanation?: string;
    revised_statement?: string;
  }>;
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

type ClaimKind = "numeric" | "directional" | "scope" | "branch" | "descriptive";

type ClaimStability = {
  claim: DisputedClaim;
  kind: ClaimKind;
  critical: boolean;
  unstable: boolean;
  reason: string;
};

type SurvivingClaims = {
  stableClaims: string[];
  excludedClaims: string[];
  excludedCriticalClaims: string[];
};

type PipelineMode = "fast_consensus" | "standard" | "deep";

type PipelineDecision = {
  mode: PipelineMode;
  reasons: string[];
  criticalDisputedCount: number;
  totalDisputedCount: number;
  missingIssueCount: number;
};

type LegalFreshnessScan = {
  needed: boolean;
  jurisdiction: string;
  tax_area: string;
  issue: string;
  recent_enacted_changes: string[];
  pending_or_proposed_changes: string[];
  effective_dates: string[];
  authority_guidance: string[];
  risk_flags: string[];
  confidence_impact: "none" | "medium" | "high";
  provider_instruction: string;
};

type LegalClaimValidation = {
  valid: boolean;
  severity: "none" | "minor" | "material" | "critical";
  high_risk_claims: string[];
  unsupported_or_suspect_claims: string[];
  possible_regime_blends: string[];
  rate_or_effective_date_risks: string[];
  provider_positions_to_discount: string[];
  required_corrections: string[];
  confidence_cap: "low" | "medium" | "high";
};

function emptyConflictMatrix(): ConflictMatrix {
  return {
    common_claims: [],
    disputed_claims: [],
    missing_or_underdeveloped_issues: [],
  };
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
  const keywordPatterns: Array<{
    topic: string;
    regex: RegExp;
    controlling?: boolean;
  }> = [
    {
      topic: "governing_tax",
      regex: /\btax\b|\bvat\b|\bgst\b|\bicms\b|\bwithholding\b|\biss\b|\bipi\b/i,
      controlling: true,
    },
    {
      topic: "buyer_status",
      regex:
        /\bbuyer\b|\bcustomer\b|\bconsumer\b|\btaxpayer\b|\bnon-taxpayer\b|\bcontributor\b|\bnon-contributor\b/i,
      controlling: true,
    },
    {
      topic: "transaction_purpose",
      regex:
        /\bresale\b|\bindustrialization\b|\bown use\b|\bfixed asset\b|\bconsumption\b|\bpurpose\b/i,
      controlling: true,
    },
    {
      topic: "transaction_type",
      regex: /\bgoods\b|\bservices\b|\bintangibles?\b|\bdigital\b/i,
      controlling: true,
    },
    {
      topic: "geography",
      regex:
        /\binterstate\b|\bcross-border\b|\borigin\b|\bdestination\b|\bstate\b|\bcountry\b/i,
      controlling: true,
    },
    {
      topic: "rate_mechanics",
      regex: /\brate\b|\b7%\b|\b12%\b|\b4%\b|\bdifal\b|\bdifferential\b|\bcredit\b/i,
      controlling: true,
    },
    {
      topic: "special_regime",
      regex: /\bst\b|\bsubstitui\b|\bexempt\b|\bdeferr/i,
      controlling: false,
    },
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

  return uniq(claims.map((x) => JSON.stringify(x))).map(
    (x) => JSON.parse(x) as NormalizedClaim
  );
}

function normalizeMemoJson(parsed: ProviderMemoJson): NormalizedMemo {
  const memoNoAnswer = {
    executive_summary: cleanMemoText(memoFieldToText(parsed?.executive_summary).trim()),
    analysis: cleanMemoText(memoFieldToText(parsed?.analysis).trim()),
    transaction_specific_treatment: cleanArray(
      normalizeStringArray(parsed?.transaction_specific_treatment)
    ),
    required_confirmations: cleanArray(
      normalizeStringArray(parsed?.required_confirmations)
    ),
    recommendation: cleanMemoText(memoFieldToText(parsed?.recommendation).trim()),
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
  if (!parsed) return emptyConflictMatrix();

  const disputed_claims: DisputedClaim[] = Array.isArray(parsed.disputed_claims)
    ? parsed.disputed_claims
        .map((d, idx) => {
          const provider_positions: ConflictPosition[] = Array.isArray(
            d?.provider_positions
          )
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
  const hay = `${input.question || ""}\n${input.facts || ""}\n${
    input.constraints || ""
  }\n${input.jurisdiction || ""}`.toLowerCase();
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

  const text = `${memo.executive_summary}\n${memo.analysis}\n${memo.transaction_specific_treatment.join(
    "\n"
  )}\n${memo.required_confirmations.join("\n")}`.toLowerCase();

  const issues: string[] = [];
  const dimensionsCovered: string[] = [];
  let penalty = 0;

  const has = {
    buyer_status:
      /\bbuyer\b|\bcustomer\b|\bconsumer\b|\btaxpayer\b|\bnon-taxpayer\b|\bcontributor\b|\bfinal consumer\b/i.test(
        text
      ),
    transaction_purpose:
      /\bresale\b|\bown use\b|\bfixed asset\b|\bconsumption\b|\bindustrialization\b|\bpurpose\b/i.test(
        text
      ),
    transaction_type:
      /\bgoods\b|\bservices\b|\bintangibles?\b|\bdigital\b/i.test(text),
    geography:
      /\binterstate\b|\bcross-border\b|\borigin\b|\bdestination\b|\bstate\b|\bcountry\b/i.test(
        text
      ),
    product_or_special_regime:
      /\bproduct\b|\bclassification\b|\bncm\b|\bimport\b|\bspecial regime\b|\bsubstitui\b|\bexempt\b/i.test(
        text
      ),
  };

  for (const dim of expected) {
    if (has[dim as keyof typeof has]) {
      dimensionsCovered.push(dim);
    } else {
      issues.push(
        `Missing coverage for expected dimension: ${dim.replace(/_/g, " ")}.`
      );
      penalty += 70;
    }
  }

  if (expected.length >= 2 && memo.transaction_specific_treatment.length === 0) {
    issues.push(
      "Missing transaction-specific treatment despite multi-branch question."
    );
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

function classifyClaimKind(text: string): ClaimKind {
  const t = text.toLowerCase();

  if (
    /\b\d+%|\brate\b|\bamount\b|\bthreshold\b|\bcalculation\b|\bdifferential\b/.test(
      t
    )
  ) {
    return "numeric";
  }

  if (
    /\borigin\b|\bdestination\b|\bfrom\b|\bto\b|\bbetween\b|\binto\b|\bout of\b|\bdirection\b/.test(
      t
    )
  ) {
    return "directional";
  }

  if (
    /\bapplies\b|\bdoes not apply\b|\bscope\b|\bonly if\b|\bunless\b|\btrigger\b|\bdue when\b/.test(
      t
    )
  ) {
    return "scope";
  }

  if (
    /\bb2b\b|\bb2c\b|\bfinal consumer\b|\btaxpayer\b|\bnon-taxpayer\b|\bresale\b|\bown use\b|\bfixed asset\b|\bindustrialization\b/.test(
      t
    )
  ) {
    return "branch";
  }

  return "descriptive";
}

function isCriticalClaimKind(kind: ClaimKind): boolean {
  return (
    kind === "numeric" ||
    kind === "directional" ||
    kind === "scope" ||
    kind === "branch"
  );
}

function evaluateClaimStability(matrix: ConflictMatrix): ClaimStability[] {
  return matrix.disputed_claims.map((claim) => {
    const corpus = [
      claim.claim_statement,
      claim.why_controlling,
      claim.challenge_prompt,
      ...claim.provider_positions.map((p) => p.position),
    ].join("\n");

    const kind = classifyClaimKind(corpus);
    const critical = isCriticalClaimKind(kind);

    const normalizedPositions = uniq(
      claim.provider_positions
        .map((p) => p.position.toLowerCase().replace(/\s+/g, " ").trim())
        .filter(Boolean)
    );

    const unstable =
      normalizedPositions.length > 1 || claim.provider_positions.length >= 2;

    return {
      claim,
      kind,
      critical,
      unstable,
      reason: unstable
        ? `Unstable ${kind} claim remained disputed after challenge-back.`
        : "Claim appears stable.",
    };
  });
}

function normalizeClaimStatement(s: string): string {
  return cleanMemoText(s).toLowerCase().replace(/\s+/g, " ").trim();
}

function buildSurvivingClaims(matrix: ConflictMatrix): SurvivingClaims {
  const stability = evaluateClaimStability(matrix);
  const excluded = stability
    .filter((x) => x.unstable)
    .map((x) => normalizeClaimStatement(x.claim.claim_statement));

  const excludedCritical = stability
    .filter((x) => x.unstable && x.critical)
    .map((x) => normalizeClaimStatement(x.claim.claim_statement));

  const stableClaims = matrix.common_claims
    .map(normalizeClaimStatement)
    .filter(Boolean)
    .filter((x) => !excluded.includes(x));

  return {
    stableClaims: uniq(stableClaims),
    excludedClaims: uniq(excluded),
    excludedCriticalClaims: uniq(excludedCritical),
  };
}

function claimMatchesExcluded(statement: string, excluded: string[]): boolean {
  const s = normalizeClaimStatement(statement);
  return excluded.some((e) => s.includes(e) || e.includes(s));
}

function filterUnstableClaimsFromArtifacts(
  artifacts: ProviderMemoArtifact[],
  matrix: ConflictMatrix
): ProviderMemoArtifact[] {
  const surviving = buildSurvivingClaims(matrix);
  if (!surviving.excludedCriticalClaims.length) return artifacts;

  return artifacts.map((artifact) => {
    const filteredClaims = artifact.memo.claims.filter(
      (c) => !claimMatchesExcluded(c.statement, surviving.excludedCriticalClaims)
    );

    const filteredTreatment = artifact.memo.transaction_specific_treatment.filter(
      (x) => !claimMatchesExcluded(x, surviving.excludedCriticalClaims)
    );

    const filteredMemo: NormalizedMemo = {
      ...artifact.memo,
      claims: filteredClaims,
      transaction_specific_treatment: filteredTreatment,
      confidence: "low",
      answer: "",
    };

    filteredMemo.answer = buildMemoAnswer({
      executive_summary: filteredMemo.executive_summary,
      analysis: filteredMemo.analysis,
      transaction_specific_treatment: filteredMemo.transaction_specific_treatment,
      required_confirmations: uniq([
        ...filteredMemo.required_confirmations,
        ...surviving.excludedCriticalClaims.map(
          (x) =>
            `Unresolved controlling issue removed from final synthesis: ${x}`
        ),
      ]),
      recommendation: filteredMemo.recommendation,
      confidence: filteredMemo.confidence,
    });

    return {
      ...artifact,
      memo: filteredMemo,
    };
  });
}

function buildProviderWorkPrompt(
  input: CrosscheckInput,
  providerLabel: string
): string {
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
    legalFreshnessBlock(input)
      ? `RECENT LAW / LEGISLATIVE CHANGE CHECK:\n${legalFreshnessBlock(input)}`
      : "",
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
    "IMPORTANT",
    "Do not assume repetition across models means correctness.",
    "If a claim collapses a conditional distinction, revise or withdraw it.",
    legalFreshnessBlock(args.input)
      ? `RECENT LAW / LEGISLATIVE CHANGE CHECK:\n${legalFreshnessBlock(args.input)}`
      : "",
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
      ? `Your provider quality assessment:\n${JSON.stringify(
          args.assessment,
          null,
          2
        )}`
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

  if (
    text.includes("vat") ||
    text.includes("tax") ||
    text.includes("withholding") ||
    text.includes("icms")
  ) {
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
  assessments: ProviderAssessment[],
  maxCount = 4
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
  if (core.length >= 2) return core.slice(0, maxCount);

  const supportOrCore = ordered.filter((a) => {
    const s = scoreMap.get(`${a.provider}::${a.model}`);
    return s?.tier === "core" || s?.tier === "supporting";
  });
  if (supportOrCore.length >= 2) return supportOrCore.slice(0, maxCount);

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
    "If a claim is numeric, directional, scope-defining, or branch-defining and providers materially differ, it must appear as disputed.",
    "",
    "Return STRICT JSON ONLY with keys:",
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
    "If a claim is numeric, directional, scope-defining, or branch-defining and providers materially differ, it must be marked disputed.",
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

function mergeConflictMatrices(
  a: ConflictMatrix | null,
  b: ConflictMatrix | null
): ConflictMatrix {
  if (!a && !b) return emptyConflictMatrix();
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

async function buildConflictMatrix(args: {
  input: CrosscheckInput;
  artifacts: ProviderMemoArtifact[];
  assessments: ProviderAssessment[];
  dual?: boolean;
}): Promise<ConflictMatrix> {
  const gpt = await extractConflictMatrixWithOpenAI(args).catch(() => null);
  if (!args.dual) return gpt || emptyConflictMatrix();

  const claude = await extractConflictMatrixWithClaude(args).catch(() => null);
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
  const selectedKeys = new Set(selected.map((a) => `${a.provider}::${a.model}`));
  return assessments.filter((a) =>
    selectedKeys.has(`${a.provider}::${a.model}`)
  );
}

async function constructCombinedDraftWithOpenAI(args: {
  input: CrosscheckInput;
  artifacts: ProviderMemoArtifact[];
  assessments: ProviderAssessment[];
  conflictMatrix: ConflictMatrix;
  survivingClaims: SurvivingClaims;
}): Promise<NormalizedMemo | null> {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) return null;

  const model =
    env("OPENAI_SYNTH_MODEL") || env("OPENAI_MODEL") || "gpt-4.1-mini";

  const client = new OpenAI({ apiKey });

  const sys = [
    "You are constructing a combined tax memo draft from multiple revised model answers.",
    "You are NOT writing a comparison.",
    "Build one concise internal memo from surviving claims only.",
    "You MUST exclude claims listed as excluded critical claims.",
    "Do not smooth over unresolved controlling conflicts.",
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
    legalFreshnessBlock(args.input)
      ? `RECENT LAW / LEGISLATIVE CHANGE CHECK:\n${legalFreshnessBlock(args.input)}`
      : "",
    "",
    "Provider assessments:",
    serializeAssessments(args.assessments),
    "",
    "Filtered revised provider artifacts:",
    serializeProviderArtifacts(args.artifacts),
    "",
    "Conflict matrix:",
    serializeConflictMatrix(args.conflictMatrix),
    "",
    "Stable claims allowed into draft:",
    JSON.stringify(args.survivingClaims.stableClaims, null, 2),
    "",
    "Excluded critical claims that must NOT be stated as fact:",
    JSON.stringify(args.survivingClaims.excludedCriticalClaims, null, 2),
  ]
    .filter(Boolean)
    .join("\n\n");

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.02,
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
  survivingClaims: SurvivingClaims;
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
    "LEVEL 2 RULES",
    "1. Re-derive the answer from surviving claims, not from prose blending.",
    "2. Weight round 2 higher than round 1.",
    "3. Weight providers with better assessments higher.",
    "4. Use the combined draft as a candidate, not as truth.",
    "5. NEVER state excluded critical claims as fact.",
    "6. If a disputed claim is numeric, directional, scope-defining, or branch-defining and remains unstable, convert it into a missing confirmation or narrow caveat instead of asserting it.",
    "7. Repetition across providers is not correctness if structural completeness is weaker.",
    "8. If a recent-law instruction is provided, explicitly distinguish current law from recently enacted, proposed, or future-effective law where material.",
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
    legalFreshnessBlock(args.input)
      ? `RECENT LAW / LEGISLATIVE CHANGE CHECK:\n${legalFreshnessBlock(args.input)}`
      : "",
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
    "Round 2 filtered provider memos:",
    serializeProviderArtifacts(args.round2),
    "",
    "Round 2 conflict matrix:",
    serializeConflictMatrix(args.conflictMatrix2),
    "",
    "Stable claims allowed into final answer:",
    JSON.stringify(args.survivingClaims.stableClaims, null, 2),
    "",
    "Excluded critical claims that must NOT be stated as fact:",
    JSON.stringify(args.survivingClaims.excludedCriticalClaims, null, 2),
    "",
    "Combined draft:",
    JSON.stringify(args.combinedDraft || {}, null, 2),
  ]
    .filter(Boolean)
    .join("\n\n");

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.02,
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
  survivingClaims: SurvivingClaims;
}): Promise<NormalizedMemo | null> {
  const prompt = [
    args.input.jurisdiction ? `Jurisdiction: ${args.input.jurisdiction}` : "",
    args.input.facts ? `Facts:\n${args.input.facts}` : "",
    args.input.constraints ? `Constraints:\n${args.input.constraints}` : "",
    `Question:\n${args.input.question}`,
    "",
    legalFreshnessBlock(args.input)
      ? `RECENT LAW / LEGISLATIVE CHANGE CHECK:\n${legalFreshnessBlock(args.input)}`
      : "",
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
    "Round 2 filtered provider memos:",
    serializeProviderArtifacts(args.round2),
    "",
    "Round 2 conflict matrix:",
    serializeConflictMatrix(args.conflictMatrix2),
    "",
    "Stable claims allowed into final answer:",
    JSON.stringify(args.survivingClaims.stableClaims, null, 2),
    "",
    "Excluded critical claims that must NOT be stated as fact:",
    JSON.stringify(args.survivingClaims.excludedCriticalClaims, null, 2),
    "",
    "Combined draft:",
    JSON.stringify(args.combinedDraft || {}, null, 2),
    "",
    "You are the final senior tax adjudicator.",
    "Re-derive the answer from surviving claims, not from prose blending.",
    "Do NOT write a model comparison.",
    "Weight round 2 higher than round 1.",
    "Use the combined draft as a candidate, not as unquestioned truth.",
    "Never state excluded critical claims as fact.",
    "If a disputed claim is numeric, directional, scope-defining, or branch-defining and remains unstable, convert it into a missing confirmation or narrow caveat instead of asserting it.",
    "If a recent-law instruction is provided, explicitly distinguish current law from recently enacted, proposed, or future-effective law where material.",
    "Prefer legal precision over generic completeness.",
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
  survivingClaims: SurvivingClaims;
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
    "Never state excluded critical claims as fact.",
    "Use the combined draft and the round 2 conflict matrix only as support.",
    "If a recent-law instruction is provided, explicitly distinguish current law from recently enacted, proposed, or future-effective law where material.",
    "Do not invent citations or authorities.",
    "Return STRICT JSON ONLY with keys:",
    "executive_summary, analysis, transaction_specific_treatment, required_confirmations, recommendation, confidence",
  ].join("\n");

  const user = [
    args.input.jurisdiction ? `Jurisdiction: ${args.input.jurisdiction}` : "",
    args.input.facts ? `Facts:\n${args.input.facts}` : "",
    `Question:\n${args.input.question}`,
    "",
    legalFreshnessBlock(args.input)
      ? `RECENT LAW / LEGISLATIVE CHANGE CHECK:\n${legalFreshnessBlock(args.input)}`
      : "",
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
    "Excluded critical claims that must NOT be stated as fact:",
    JSON.stringify(args.survivingClaims.excludedCriticalClaims, null, 2),
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

function decidePipelineMode(args: {
  selectedRound1: ProviderMemoArtifact[];
  selectedAssessments: ProviderAssessment[];
  round1ConflictMatrix: ConflictMatrix;
}): PipelineDecision {
  const stability = evaluateClaimStability(args.round1ConflictMatrix);
  const criticalDisputedCount = stability.filter(
    (x) => x.critical && x.unstable
  ).length;
  const totalDisputedCount = args.round1ConflictMatrix.disputed_claims.length;
  const missingIssueCount =
    args.round1ConflictMatrix.missing_or_underdeveloped_issues.length;

  if (
    args.selectedRound1.length >= 3 &&
    criticalDisputedCount === 0 &&
    totalDisputedCount <= 1 &&
    missingIssueCount <= 1
  ) {
    return {
      mode: "fast_consensus",
      reasons: ["strong round-1 convergence", "no critical disputed claims"],
      criticalDisputedCount,
      totalDisputedCount,
      missingIssueCount,
    };
  }

  if (criticalDisputedCount >= 2 || missingIssueCount >= 3) {
    return {
      mode: "deep",
      reasons: ["multiple critical disputes or weak structural coverage"],
      criticalDisputedCount,
      totalDisputedCount,
      missingIssueCount,
    };
  }

  return {
    mode: "standard",
    reasons: ["some disagreement requires challenge-back"],
    criticalDisputedCount,
    totalDisputedCount,
    missingIssueCount,
  };
}


function isDeepRun(input: CrosscheckInput, timeoutMs: number): boolean {
  const rawMode = String((input as any).mode || (input as any).pipelineMode || "")
    .trim()
    .toLowerCase();

  if (rawMode === "deep" || rawMode === "deep_mode") return true;
  if (rawMode === "fast" || rawMode === "fast_mode") return false;

  // Current UI already sends 60s for first run and 30s for follow-ups.
  // So timeout is the safest backward-compatible signal without changing types.
  return timeoutMs >= 45_000;
}

function minSuccessfulProviderCount(deep: boolean): number {
  return deep
    ? clampInt(env("CROSSCHECK_DEEP_MIN_SUCCESS"), 1, 10, 4)
    : clampInt(env("CROSSCHECK_FAST_MIN_SUCCESS"), 1, 10, 2);
}

function deepRetryEnabled(): boolean {
  const raw = (env("CROSSCHECK_DEEP_RETRY") || "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off";
}

function retryTimeoutMs(timeoutMs: number): number {
  return clampInt(
    env("CROSSCHECK_DEEP_RETRY_TIMEOUT_MS"),
    8_000,
    120_000,
    Math.min(timeoutMs, 45_000)
  );
}



function normalizeLegalFreshnessScan(parsed: Partial<LegalFreshnessScan> | null): LegalFreshnessScan | null {
  if (!parsed) return null;

  const confidenceImpact = String(parsed.confidence_impact || "none").toLowerCase();
  const normalizedImpact: LegalFreshnessScan["confidence_impact"] =
    confidenceImpact === "high" || confidenceImpact === "medium" ? confidenceImpact : "none";

  const scan: LegalFreshnessScan = {
    needed: Boolean(parsed.needed),
    jurisdiction: cleanMemoText(String(parsed.jurisdiction || "").trim()),
    tax_area: cleanMemoText(String(parsed.tax_area || "").trim()),
    issue: cleanMemoText(String(parsed.issue || "").trim()),
    recent_enacted_changes: cleanArray(normalizeStringArray(parsed.recent_enacted_changes)),
    pending_or_proposed_changes: cleanArray(normalizeStringArray(parsed.pending_or_proposed_changes)),
    effective_dates: cleanArray(normalizeStringArray(parsed.effective_dates)),
    authority_guidance: cleanArray(normalizeStringArray(parsed.authority_guidance)),
    risk_flags: cleanArray(normalizeStringArray(parsed.risk_flags)),
    confidence_impact: normalizedImpact,
    provider_instruction: cleanMemoText(String(parsed.provider_instruction || "").trim()),
  };

  if (!scan.needed && !scan.provider_instruction && !scan.risk_flags.length) return null;
  return scan;
}

function legalFreshnessQuestionLooksRelevant(input: CrosscheckInput): boolean {
  const hay = `${input.question || ""}\n${input.facts || ""}\n${input.constraints || ""}\n${input.jurisdiction || ""}`.toLowerCase();

  const taxSignals = [
    "tax",
    "vat",
    "iva",
    "gst",
    "ieps",
    "withholding",
    "income tax",
    "corporate tax",
    "digital services",
    "customs",
    "import",
    "transfer pricing",
    "permanent establishment",
    "treaty",
    "reform",
    "law",
    "regulation",
    "effective",
    "enacted",
    "proposed",
    "bill",
    "decree",
    "guidance",
    "rate",
  ];

  return taxSignals.some((x) => hay.includes(x));
}

function buildLegalFreshnessInstruction(scan: LegalFreshnessScan | null): string {
  if (!scan) return "";

  const lines: string[] = [
    "Before answering, account for recent enacted legislation, pending/proposed changes, effective dates, and tax authority guidance that may affect the answer.",
    "Separate current law from proposed or future-effective law.",
    "Do not treat proposed changes as enacted.",
    "If a recent change creates uncertainty, state the current-law answer and the change-sensitive caveat separately.",
  ];

  if (scan.jurisdiction) lines.push(`Detected jurisdiction: ${scan.jurisdiction}`);
  if (scan.tax_area) lines.push(`Detected tax area: ${scan.tax_area}`);
  if (scan.issue) lines.push(`Detected issue: ${scan.issue}`);

  if (scan.recent_enacted_changes.length) {
    lines.push("Recent enacted changes to consider:");
    scan.recent_enacted_changes.forEach((x) => lines.push(`- ${x}`));
  }

  if (scan.pending_or_proposed_changes.length) {
    lines.push("Pending or proposed changes to distinguish from current law:");
    scan.pending_or_proposed_changes.forEach((x) => lines.push(`- ${x}`));
  }

  if (scan.effective_dates.length) {
    lines.push("Effective dates / transition points:");
    scan.effective_dates.forEach((x) => lines.push(`- ${x}`));
  }

  if (scan.authority_guidance.length) {
    lines.push("Authority guidance to consider:");
    scan.authority_guidance.forEach((x) => lines.push(`- ${x}`));
  }

  if (scan.risk_flags.length) {
    lines.push("Freshness risk flags:");
    scan.risk_flags.forEach((x) => lines.push(`- ${x}`));
  }

  if (scan.provider_instruction) {
    lines.push("Specific freshness instruction:");
    lines.push(scan.provider_instruction);
  }

  return lines.join("\n").trim();
}

function legalFreshnessBlock(input: CrosscheckInput): string {
  return String((input as any).legalFreshnessInstruction || "").trim();
}



function normalizeLegalClaimValidation(
  parsed: Partial<LegalClaimValidation> | null
): LegalClaimValidation | null {
  if (!parsed) return null;

  const severityRaw = String(parsed.severity || "none").toLowerCase();
  const severity: LegalClaimValidation["severity"] =
    severityRaw === "critical" ||
    severityRaw === "material" ||
    severityRaw === "minor" ||
    severityRaw === "none"
      ? severityRaw
      : "none";

  const capRaw = String(parsed.confidence_cap || "").toLowerCase();
  let confidence_cap: LegalClaimValidation["confidence_cap"] =
    capRaw === "low" || capRaw === "medium" || capRaw === "high"
      ? capRaw
      : severity === "critical"
      ? "low"
      : severity === "material"
      ? "medium"
      : "high";

  if (severity === "critical") confidence_cap = "low";
  if (severity === "material" && confidence_cap === "high") confidence_cap = "medium";

  const out: LegalClaimValidation = {
    valid: Boolean(parsed.valid) && severity !== "critical" && severity !== "material",
    severity,
    high_risk_claims: cleanArray(normalizeStringArray(parsed.high_risk_claims)),
    unsupported_or_suspect_claims: cleanArray(
      normalizeStringArray(parsed.unsupported_or_suspect_claims)
    ),
    possible_regime_blends: cleanArray(normalizeStringArray(parsed.possible_regime_blends)),
    rate_or_effective_date_risks: cleanArray(
      normalizeStringArray(parsed.rate_or_effective_date_risks)
    ),
    provider_positions_to_discount: cleanArray(
      normalizeStringArray(parsed.provider_positions_to_discount)
    ),
    required_corrections: cleanArray(normalizeStringArray(parsed.required_corrections)),
    confidence_cap,
  };

  const hasContent =
    out.high_risk_claims.length ||
    out.unsupported_or_suspect_claims.length ||
    out.possible_regime_blends.length ||
    out.rate_or_effective_date_risks.length ||
    out.required_corrections.length;

  if (!hasContent && out.severity === "none") return null;
  return out;
}

function legalClaimValidationLooksNeeded(args: {
  input: CrosscheckInput;
  finalMemo: NormalizedMemo | null;
  artifacts: ProviderMemoArtifact[];
}): boolean {
  const text = [
    args.input.question,
    args.input.facts,
    args.input.constraints,
    args.input.jurisdiction,
    args.finalMemo?.answer || "",
    ...args.artifacts.map((a) => a.memo.answer),
  ]
    .join("\n")
    .toLowerCase();

  const highRiskSignals = [
    "article",
    "art.",
    "section",
    "title",
    "chapter",
    "regulation",
    "law",
    "statute",
    "code",
    "rate",
    "%",
    "effective",
    "enacted",
    "withhold",
    "withholding",
    "register",
    "registration",
    "monthly",
    "return",
    "compliance",
    "taxable",
    "exempt",
    "not subject",
    "subject to",
    "permanent establishment",
    "foreign resident",
    "non-resident",
  ];

  return highRiskSignals.some((x) => text.includes(x));
}

async function validateLegalClaimsWithOpenAI(args: {
  input: CrosscheckInput;
  finalMemo: NormalizedMemo | null;
  reasoningArtifacts: ProviderMemoArtifact[];
  assessments: ProviderAssessment[];
  conflictMatrix: ConflictMatrix;
  freshnessScan: LegalFreshnessScan | null;
}): Promise<LegalClaimValidation | null> {
  if (!args.finalMemo) return null;
  if (!legalClaimValidationLooksNeeded({
    input: args.input,
    finalMemo: args.finalMemo,
    artifacts: args.reasoningArtifacts,
  })) {
    return null;
  }

  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) return null;

  const model =
    env("OPENAI_CLAIM_VALIDATOR_MODEL") ||
    env("OPENAI_ADJUDICATOR_MODEL") ||
    env("OPENAI_SYNTH_MODEL") ||
    env("OPENAI_MODEL") ||
    "gpt-4.1-mini";

  const client = new OpenAI({ apiKey });

  const sys = [
    "You are a senior tax quality-control reviewer.",
    "You do NOT answer the user's tax question.",
    "Your job is to review the final memo and provider artifacts for high-risk legal/tax assertions.",
    "",
    "High-risk assertions include:",
    "- statutory article or section references",
    "- named regimes or titles",
    "- tax rates or percentages",
    "- effective dates or recent-law statements",
    "- registration, withholding, filing, or payment mechanisms",
    "- claims that a taxpayer is subject to, exempt from, or outside a tax",
    "- claims that may blend one tax regime into another",
    "",
    "You must identify unsupported, internally inconsistent, overconfident, or suspicious claims.",
    "Do not require formal citations. Instead evaluate whether the final memo has enough support from the provider artifacts and whether provider positions materially conflict.",
    "If providers conflict on a statutory article, tax rate, effective date, named regime, or compliance mechanism, flag it.",
    "If the final memo adopts a disputed high-risk claim without narrowing or confirmation, severity should be material or critical.",
    "If the final memo is cautious and converts disputed high-risk claims into required confirmations, severity can be minor or none.",
    "",
    "Return STRICT JSON ONLY with keys:",
    "valid, severity, high_risk_claims, unsupported_or_suspect_claims, possible_regime_blends, rate_or_effective_date_risks, provider_positions_to_discount, required_corrections, confidence_cap.",
  ].join("\n");

  const user = [
    args.input.jurisdiction ? `Jurisdiction: ${args.input.jurisdiction}` : "",
    args.input.facts ? `Facts:\n${args.input.facts}` : "",
    args.input.constraints ? `Constraints:\n${args.input.constraints}` : "",
    `Question:\n${args.input.question}`,
    "",
    "Legal freshness scan:",
    JSON.stringify(args.freshnessScan || {}, null, 2),
    "",
    "Provider assessments:",
    serializeAssessments(args.assessments),
    "",
    "Conflict matrix:",
    serializeConflictMatrix(args.conflictMatrix),
    "",
    "Provider artifacts used for reasoning:",
    serializeProviderArtifacts(args.reasoningArtifacts),
    "",
    "Final memo to validate:",
    JSON.stringify(args.finalMemo, null, 2),
  ]
    .filter(Boolean)
    .join("\n\n");

  const resp = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    max_tokens: 1200,
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";
  const parsed = safeJsonParse<Partial<LegalClaimValidation>>(extractJsonObject(raw));
  return normalizeLegalClaimValidation(parsed);
}



async function rewriteFinalMemoConservativelyWithOpenAI(args: {
  input: CrosscheckInput;
  finalMemo: NormalizedMemo | null;
  reasoningArtifacts: ProviderMemoArtifact[];
  assessments: ProviderAssessment[];
  conflictMatrix: ConflictMatrix;
  legalClaimValidation: LegalClaimValidation | null;
  highRiskProviderConflicts: string[];
  freshnessScan: LegalFreshnessScan | null;
}): Promise<NormalizedMemo | null> {
  if (!args.finalMemo) return null;
  if (!args.highRiskProviderConflicts.length) return args.finalMemo;

  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) return args.finalMemo;

  const model =
    env("OPENAI_CONSERVATIVE_REWRITE_MODEL") ||
    env("OPENAI_ADJUDICATOR_MODEL") ||
    env("OPENAI_SYNTH_MODEL") ||
    env("OPENAI_MODEL") ||
    "gpt-4.1-mini";

  const client = new OpenAI({ apiKey });

  const sys = [
    "You are a senior tax quality-control editor.",
    "You are rewriting a final tax memo after a high-risk legal conflict was detected.",
    "Your task is NOT to make the answer more aggressive.",
    "Your task is to make the answer professionally conservative and reliance-safe.",
    "",
    "MANDATORY RULES",
    "1. Do not assert disputed statutory articles, tax rates, effective dates, or compliance mechanisms as settled facts.",
    "2. Convert disputed high-risk claims into required confirmations or narrow caveats.",
    "3. Use only undisputed or well-supported claims as affirmative conclusions.",
    "4. If providers disagree on whether an activity is inside an enumerated taxable category, say that the classification must be verified before concluding liability.",
    "5. Separate ordinary/core activities from contingent or special activities.",
    "6. Separate current law from recently enacted, proposed, or future-effective law if a freshness instruction is present.",
    "7. Do not mention providers, models, or internal validation mechanics.",
    "8. Do not invent citations or authorities.",
    "",
    "OUTPUT STYLE",
    "- Professional tax memo tone.",
    "- Conservative, clear, and decision-useful.",
    "- Prefer 'may apply if...' over 'applies' where statutory classification is disputed.",
    "- Prefer 'not subject merely because...' where only the taxpayer identity or digital nature is known.",
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
    legalFreshnessBlock(args.input)
      ? `RECENT LAW / LEGISLATIVE CHANGE CHECK:\n${legalFreshnessBlock(args.input)}`
      : "",
    "",
    "High-risk provider conflicts that triggered rewrite:",
    JSON.stringify(args.highRiskProviderConflicts, null, 2),
    "",
    "Legal claim validation:",
    JSON.stringify(args.legalClaimValidation || {}, null, 2),
    "",
    "Conflict matrix:",
    serializeConflictMatrix(args.conflictMatrix),
    "",
    "Provider assessments:",
    serializeAssessments(args.assessments),
    "",
    "Provider artifacts used for reasoning:",
    serializeProviderArtifacts(args.reasoningArtifacts),
    "",
    "Original final memo that must be rewritten conservatively:",
    JSON.stringify(args.finalMemo, null, 2),
  ]
    .filter(Boolean)
    .join("\n\n");

  const resp = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    max_tokens: 1800,
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";
  const parsed = safeJsonParse<MemoJson>(extractJsonObject(raw));
  if (!parsed) return args.finalMemo;

  const rewritten = normalizeMemoJson(parsed);

  return {
    ...rewritten,
    confidence:
      args.legalClaimValidation?.severity === "critical"
        ? "low"
        : rewritten.confidence === "high"
        ? "medium"
        : rewritten.confidence,
  };
}


function highRiskLegalText(s: string): string {
  return String(s || "").toLowerCase();
}

function artifactHasHighRiskPositiveLiabilityClaim(a: ProviderMemoArtifact): boolean {
  const t = highRiskLegalText(a.memo.answer);
  return (
    /\bsubject to\b/.test(t) ||
    /\btaxable\b/.test(t) ||
    /\bliability\b/.test(t) ||
    /\bmust register\b/.test(t) ||
    /\bmust appoint\b/.test(t) ||
    /\bwithhold\b/.test(t) ||
    /\bremit\b/.test(t)
  ) && (
    /\barticle\b|\bart\.|\bsection\b|\btitle\b|\bfraction\b|\brate\b|\b\d+%|\beffective\b|\breform\b|\bregister\b|\bwithhold\b|\bremit\b/.test(t)
  );
}

function artifactHasHighRiskNegativeLiabilityClaim(a: ProviderMemoArtifact): boolean {
  const t = highRiskLegalText(a.memo.answer);
  return (
    /\bnot subject to\b/.test(t) ||
    /\boutside\b.{0,80}\bscope\b/.test(t) ||
    /\bdoes not apply\b/.test(t) ||
    /\bno .*liability\b/.test(t) ||
    /\bnot .*taxable\b/.test(t)
  ) && (
    /\barticle\b|\bart\.|\bsection\b|\btitle\b|\bfraction\b|\brate\b|\b\d+%|\beffective\b|\breform\b|\bregister\b|\bwithhold\b|\bremit\b|\benumerated\b/.test(t)
  );
}

function detectHighRiskProviderConflict(artifacts: ProviderMemoArtifact[]): string[] {
  const positives = artifacts.filter(artifactHasHighRiskPositiveLiabilityClaim);
  const negatives = artifacts.filter(artifactHasHighRiskNegativeLiabilityClaim);

  if (positives.length >= 1 && negatives.length >= 1) {
    return [
      `High-risk statutory conflict detected: ${positives.length} provider output(s) asserted possible taxability/liability using statutory, rate, effective-date, or compliance mechanics, while ${negatives.length} provider output(s) asserted non-taxability or exclusion. The final answer should not state the aggressive liability position as settled without external verification.`,
    ];
  }

  return [];
}

function finalMemoStatesAggressiveHighRiskLiability(memo: NormalizedMemo | null): boolean {
  if (!memo) return false;
  const t = highRiskLegalText(memo.answer);

  const assertsLiability =
    /\bsubject to\b/.test(t) ||
    /\btaxable\b/.test(t) ||
    /\bliability\b/.test(t) ||
    /\bmust register\b/.test(t) ||
    /\bmust appoint\b/.test(t) ||
    /\bmust .*remit\b/.test(t);

  const hasHardMechanics =
    /\barticle\b|\bart\.|\bsection\b|\btitle\b|\bfraction\b|\brate\b|\b\d+%|\beffective\b|\breform\b|\bregister\b|\bwithhold\b|\bremit\b/.test(t);

  const isCautious =
    /\brequires verification\b|\bmust be verified\b|\bconfirm\b|\bsubject to confirmation\b|\bpotential\b|\bmay\b|\bcould\b|\bfact-dependent\b/.test(t);

  return assertsLiability && hasHardMechanics && !isCautious;
}

function highRiskConflictCaveats(conflicts: string[]): string[] {
  return conflicts.map((x) => `High-risk legal conflict: ${x}`);
}

function highRiskConflictFollowups(conflicts: string[]): string[] {
  if (!conflicts.length) return [];
  return [
    "Verify the statutory article, tax rate, effective date, and compliance mechanism before treating the liability conclusion as settled.",
    "Resolve provider disagreement on whether the relevant activity is actually inside the enumerated taxable category.",
  ];
}


function legalClaimValidationCaveats(validation: LegalClaimValidation | null): string[] {
  if (!validation) return [];

  const caveats: string[] = [];

  if (validation.severity === "critical") {
    caveats.push(
      "Critical legal-claim validation risk was detected. The answer may contain unsupported statutory, rate, effective-date, or regime-specific assertions. Confidence was capped."
    );
  } else if (validation.severity === "material") {
    caveats.push(
      "Material legal-claim validation risk was detected. Some statutory, rate, effective-date, or compliance assertions require verification before reliance."
    );
  } else if (validation.severity === "minor") {
    caveats.push(
      "Minor legal-claim validation risk was detected. Confirm the statutory basis, rate, or effective date before relying on precise treatment."
    );
  }

  return uniq([
    ...caveats,
    ...validation.possible_regime_blends.map(
      (x) => `Possible tax-regime blend to verify: ${x}`
    ),
    ...validation.rate_or_effective_date_risks.map(
      (x) => `Rate/effective-date issue to verify: ${x}`
    ),
  ]);
}

function legalClaimValidationFollowups(validation: LegalClaimValidation | null): string[] {
  if (!validation) return [];

  return uniq([
    ...validation.required_corrections,
    ...validation.unsupported_or_suspect_claims.map(
      (x) => `Verify or revise unsupported/suspect claim: ${x}`
    ),
    ...validation.high_risk_claims.slice(0, 5).map(
      (x) => `Confirm statutory support for high-risk claim: ${x}`
    ),
  ]);
}


function finalMemoAddressesFreshness(
  memo: NormalizedMemo | null,
  scan: LegalFreshnessScan | null
): boolean {
  if (!memo || !scan) return true;

  const text = [
    memo.executive_summary,
    memo.analysis,
    memo.transaction_specific_treatment.join("\n"),
    memo.required_confirmations.join("\n"),
    memo.recommendation,
  ]
    .join("\n")
    .toLowerCase();

  const structuralSignals = [
    "current law",
    "current-law",
    "recent",
    "recently enacted",
    "enacted",
    "proposed",
    "pending",
    "effective date",
    "effective-date",
    "transition",
    "transitional",
    "legislative",
    "reform",
    "law change",
    "rate change",
    "guidance",
  ];

  const hasStructuralSignal = structuralSignals.some((x) => text.includes(x));

  const scanTerms = [
    scan.tax_area,
    scan.issue,
    ...scan.recent_enacted_changes,
    ...scan.pending_or_proposed_changes,
    ...scan.effective_dates,
    ...scan.authority_guidance,
    ...scan.risk_flags,
  ]
    .map((x) => String(x || "").toLowerCase())
    .flatMap((x) => x.split(/[^a-z0-9áéíóúüñ]+/i))
    .map((x) => x.trim())
    .filter((x) => x.length >= 5);

  const uniqueScanTerms = uniq(scanTerms);
  const matchedScanTerms = uniqueScanTerms.filter((term) => text.includes(term));

  // General rule:
  // - The final memo must visibly address legal freshness using structural language.
  // - If the scan identified concrete terms, at least some must appear in the memo.
  if (!hasStructuralSignal) return false;
  if (uniqueScanTerms.length >= 4 && matchedScanTerms.length < 2) return false;

  return true;
}

function freshnessConfidenceCap(
  scan: LegalFreshnessScan | null,
  memo: NormalizedMemo | null
): "low" | "medium" | "high" {
  if (!scan) return "high";

  const addressed = finalMemoAddressesFreshness(memo, scan);

  if (scan.confidence_impact === "high" && !addressed) return "low";
  if (scan.confidence_impact === "medium" && !addressed) return "medium";
  if (scan.confidence_impact === "high" && addressed) return "medium";

  return "high";
}

function applyConfidenceCap(
  confidence: "low" | "medium" | "high",
  cap: "low" | "medium" | "high"
): "low" | "medium" | "high" {
  const rank = { low: 0, medium: 1, high: 2 } as const;
  if (rank[confidence] <= rank[cap]) return confidence;
  return cap;
}

function freshnessEnforcementCaveat(
  scan: LegalFreshnessScan | null,
  memo: NormalizedMemo | null
): string[] {
  if (!scan) return [];

  const addressed = finalMemoAddressesFreshness(memo, scan);
  if (addressed) {
    return [
      "Recent-law sensitivity was reviewed and reflected in the final synthesis.",
    ];
  }

  return [
    "Recent-law sensitivity was detected, but the final synthesis did not clearly distinguish current law from recently enacted, proposed, or future-effective changes. Confidence was capped accordingly.",
  ];
}


async function runLegalFreshnessScan(input: CrosscheckInput): Promise<LegalFreshnessScan | null> {
  if (!legalFreshnessQuestionLooksRelevant(input)) return null;

  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) return null;

  const model =
    env("OPENAI_FRESHNESS_MODEL") ||
    env("OPENAI_ADJUDICATOR_MODEL") ||
    env("OPENAI_SYNTH_MODEL") ||
    env("OPENAI_MODEL") ||
    "gpt-4.1-mini";

  const client = new OpenAI({ apiKey });

  const sys = [
    "You are a tax-law freshness scanner.",
    "You do NOT answer the user's tax question.",
    "Your job is to identify whether the question may be affected by recently enacted legislation, proposed bills, rate changes, effective-date changes, transition rules, or tax authority guidance.",
    "This is jurisdiction-neutral and tax-type-neutral.",
    "Do not invent specific authorities.",
    "If you are not sure whether a change exists, flag the issue as freshness-sensitive rather than asserting a change.",
    "Return STRICT JSON ONLY with keys:",
    "needed, jurisdiction, tax_area, issue, recent_enacted_changes, pending_or_proposed_changes, effective_dates, authority_guidance, risk_flags, confidence_impact, provider_instruction.",
  ].join("\n");

  const user = [
    input.jurisdiction ? `Jurisdiction: ${input.jurisdiction}` : "",
    input.facts ? `Facts:\n${input.facts}` : "",
    input.constraints ? `Constraints:\n${input.constraints}` : "",
    `Question:\n${input.question}`,
    "",
    "Decide whether recent-law sensitivity should be injected into the provider prompts.",
    "Focus on whether current law, recently enacted law, proposed changes, or effective dates could materially change the answer.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const resp = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    max_tokens: 900,
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";
  const parsed = safeJsonParse<Partial<LegalFreshnessScan>>(extractJsonObject(raw));
  return normalizeLegalFreshnessScan(parsed);
}


export async function runCrosscheck(
  input: CrosscheckInput
): Promise<CrosscheckResult> {
  const t0 = Date.now();
  const timeoutMs = clampInt(input.timeoutMs, 8_000, 120_000, 18_000);
  const deepRun = isDeepRun(input, timeoutMs);
  const minSuccessfulProviders = minSuccessfulProviderCount(deepRun);

  const legalFreshnessScan = deepRun
    ? await runLegalFreshnessScan(input).catch(() => null)
    : null;

  const workingInput: CrosscheckInput = legalFreshnessScan
    ? ({
        ...input,
        legalFreshnessScan,
        legalFreshnessInstruction: buildLegalFreshnessInstruction(legalFreshnessScan),
      } as CrosscheckInput)
    : input;

  const attempted: ProviderCall[] = [];

  type ProviderRunner = {
    call: ProviderCall;
    fn: () => Promise<ProviderOutput>;
  };

  const providerRunners: ProviderRunner[] = [];

  const addRunner = (
    call: ProviderCall,
    fn: () => Promise<ProviderOutput>
  ): void => {
    providerRunners.push({ call, fn });
  };

  const wrap = (
    call: ProviderCall,
    fn: () => Promise<ProviderOutput>,
    ms = timeoutMs
  ): Promise<ProviderOutput> => {
    attempted.push(call);
    return withTimeout(fn(), ms).catch((e: any) => {
      const msg = e?.message ? String(e.message) : String(e);
      const status = msg.toLowerCase().includes("timeout") ? "timeout" : "error";
      return {
        provider: call.provider,
        model: call.model,
        status,
        ms,
        error: msg,
      } satisfies ProviderOutput;
    });
  };

  const collectFast = async (runners: ProviderRunner[]): Promise<ProviderOutput[]> => {
    const providers: ProviderOutput[] = [];
    const pending = runners.map((r) =>
      wrap(r.call, r.fn).then((out) => ({ key: `${r.call.provider}::${r.call.model}`, out }))
    );

    while (pending.length) {
      const result = await Promise.race(pending);
      providers.push(result.out);

      const idx = pending.findIndex((p) =>
        p.then((x) => x.key).then((key) => key === result.key)
      );

      // Promise identity is awkward after wrapping above, so remove by completed key.
      const removeIdx = await Promise.resolve(
        pending.findIndex(async (p) => (await p).key === result.key)
      );

      if (removeIdx >= 0) pending.splice(removeIdx, 1);
      else break;

      const successCount = providers.filter((p) => p.status === "ok").length;
      if (successCount >= minSuccessfulProviders) break;
    }

    return providers;
  };

  const collectAll = async (
    runners: ProviderRunner[],
    ms = timeoutMs
  ): Promise<ProviderOutput[]> => {
    return Promise.all(runners.map((r) => wrap(r.call, r.fn, ms)));
  };

  const openaiModel = env("OPENAI_MODEL") || "gpt-4.1-mini";
  addRunner({ provider: "openai", model: openaiModel }, async () => {
    const result = await callOpenAI(wrapInputForRound1(workingInput, "OpenAI"));
    return repackageProviderOutput(result, "openai");
  });

  for (const m of defaultOpenRouterModels()) {
    addRunner({ provider: "openrouter", model: m }, async () => {
      const result = await callOpenRouter(wrapInputForRound1(workingInput, m), m);
      return repackageProviderOutput(result, "openrouter");
    });
  }

  if (geminiEnabled()) {
    const geminiModel = env("GEMINI_MODEL") || "gemini-2.5-flash";
    addRunner({ provider: "gemini", model: geminiModel }, async () => {
      const result = await callGemini(wrapInputForRound1(workingInput, "Gemini"));
      return repackageProviderOutput(result, "gemini");
    });
  }

  let providers: ProviderOutput[] = deepRun
    ? await collectAll(providerRunners)
    : await collectFast(providerRunners);

  const successfulProviderKeys = new Set(
    providers
      .filter((p) => p.status === "ok")
      .map((p) => `${p.provider}::${p.model}`)
  );

  if (
    deepRun &&
    deepRetryEnabled() &&
    successfulProviderKeys.size < minSuccessfulProviders
  ) {
    const failedOrMissingRunners = providerRunners.filter(
      (r) => !successfulProviderKeys.has(`${r.call.provider}::${r.call.model}`)
    );

    const retryResults = await collectAll(failedOrMissingRunners, retryTimeoutMs(timeoutMs));

    const byKey = new Map<string, ProviderOutput>();
    for (const p of providers) byKey.set(`${p.provider}::${p.model}`, p);

    for (const retry of retryResults) {
      const key = `${retry.provider}::${retry.model}`;
      const prior = byKey.get(key);

      if (!prior || (prior.status !== "ok" && retry.status === "ok")) {
        byKey.set(key, retry);
      }
    }

    providers = Array.from(byKey.values());
  }

  const succeededCalls: ProviderCall[] = [];
  const failedCalls: ProviderCall[] = [];

  for (const p of providers) {
    const call: ProviderCall = { provider: p.provider, model: p.model };
    if (p.status === "ok") succeededCalls.push(call);
    else failedCalls.push(call);
  }

  const round1Artifacts = buildInitialArtifacts(providers);
  const round1Assessments = round1Artifacts.map((a) =>
    providerAssessmentForArtifact(a, workingInput)
  );
  const selectedRound1 = chooseArtifactsForReasoning(
    round1Artifacts,
    round1Assessments,
    4
  );
  const selectedAssessments = summarizeAssessmentsForSelection(
    round1Assessments,
    selectedRound1
  );
  const bestArtifact = pickBestArtifact(round1Artifacts, round1Assessments);

  let round1ConflictMatrix: ConflictMatrix = emptyConflictMatrix();
  let pipelineDecision: PipelineDecision = {
    mode: "standard",
    reasons: ["default"],
    criticalDisputedCount: 0,
    totalDisputedCount: 0,
    missingIssueCount: 0,
  };

  let round2Artifacts: ProviderMemoArtifact[] = [];
  let round2Assessments: ProviderAssessment[] = [];
  let round2ConflictMatrix: ConflictMatrix = emptyConflictMatrix();

  if (selectedRound1.length >= 3) {
    round1ConflictMatrix = await buildConflictMatrix({
      input: workingInput,
      artifacts: selectedRound1,
      assessments: selectedAssessments,
      dual: selectedRound1.length < 3 ? true : false,
    }).catch(() => emptyConflictMatrix());

    pipelineDecision = decidePipelineMode({
      selectedRound1,
      selectedAssessments,
      round1ConflictMatrix,
    });

    if (pipelineDecision.mode !== "fast_consensus") {
      const assessmentMap = assessmentMapFor(selectedAssessments);

      const round2Candidates = chooseArtifactsForReasoning(
        selectedRound1,
        selectedAssessments,
        pipelineDecision.mode === "deep" ? 4 : 3
      );

      const revised = await Promise.all(
        round2Candidates.map((artifact) =>
          runProviderRound2(
            artifact,
            workingInput,
            round1ConflictMatrix,
            assessmentMap.get(`${artifact.provider}::${artifact.model}`)
          ).catch(() => null)
        )
      );

      round2Artifacts = revised.filter(Boolean) as ProviderMemoArtifact[];
      round2Assessments = round2Artifacts.map((a) =>
        providerAssessmentForArtifact(a, workingInput)
      );

      if (round2Artifacts.length >= 2) {
        round2ConflictMatrix = await buildConflictMatrix({
          input: workingInput,
          artifacts: round2Artifacts,
          assessments: round2Assessments,
          dual: pipelineDecision.mode === "deep",
        }).catch(() => emptyConflictMatrix());
      }
    }
  }

  let reasoningArtifacts: ProviderMemoArtifact[] =
    pipelineDecision.mode === "fast_consensus"
      ? selectedRound1
      : round2Artifacts.length >= 2
      ? round2Artifacts
      : selectedRound1;

  const reasoningAssessments: ProviderAssessment[] =
    pipelineDecision.mode === "fast_consensus"
      ? selectedAssessments
      : round2Artifacts.length >= 2
      ? round2Assessments
      : selectedAssessments;

  const reasoningConflictMatrix: ConflictMatrix =
    pipelineDecision.mode === "fast_consensus"
      ? round1ConflictMatrix
      : round2Artifacts.length >= 2
      ? round2ConflictMatrix
      : round1ConflictMatrix;

  const survivingClaims = buildSurvivingClaims(reasoningConflictMatrix);
  reasoningArtifacts = filterUnstableClaimsFromArtifacts(
    reasoningArtifacts,
    reasoningConflictMatrix
  );

  let combinedDraft: NormalizedMemo | null = null;
  if (reasoningArtifacts.length >= 2) {
    combinedDraft = await constructCombinedDraftWithOpenAI({
      input: workingInput,
      artifacts: reasoningArtifacts,
      assessments: reasoningAssessments,
      conflictMatrix: reasoningConflictMatrix,
      survivingClaims,
    }).catch(() => null);
  }

  let finalMemo: NormalizedMemo | null = null;

  if (pipelineDecision.mode === "fast_consensus") {
    finalMemo =
      combinedDraft ||
      pickBestArtifact(reasoningArtifacts, reasoningAssessments)?.memo ||
      bestArtifact?.memo ||
      null;
  }

  if (!finalMemo && reasoningArtifacts.length >= 2) {
    if (dualAdjudicatorEnabled()) {
      const [gptFinal, claudeFinal] = await Promise.all([
        adjudicateFinalWithOpenAI({
          input: workingInput,
          round1: selectedRound1,
          round2: reasoningArtifacts,
          combinedDraft,
          assessments: reasoningAssessments,
          conflictMatrix1: round1ConflictMatrix,
          conflictMatrix2: reasoningConflictMatrix,
          survivingClaims,
        }).catch(() => null),
        adjudicateFinalWithClaude({
          input: workingInput,
          round1: selectedRound1,
          round2: reasoningArtifacts,
          combinedDraft,
          assessments: reasoningAssessments,
          conflictMatrix1: round1ConflictMatrix,
          conflictMatrix2: reasoningConflictMatrix,
          survivingClaims,
        }).catch(() => null),
      ]);

      finalMemo = await mergeFinalMemosWithOpenAI({
        input: workingInput,
        gpt: gptFinal,
        claude: claudeFinal,
        combinedDraft,
        conflictMatrix2: reasoningConflictMatrix,
        survivingClaims,
      }).catch(() => gptFinal || claudeFinal || combinedDraft || null);
    } else {
      finalMemo = await adjudicateFinalWithOpenAI({
        input: workingInput,
        round1: selectedRound1,
        round2: reasoningArtifacts,
        combinedDraft,
        assessments: reasoningAssessments,
        conflictMatrix1: round1ConflictMatrix,
        conflictMatrix2: reasoningConflictMatrix,
        survivingClaims,
      }).catch(() => combinedDraft);
    }
  }

  if (!finalMemo && combinedDraft) {
    finalMemo = combinedDraft;
  }

  if (!finalMemo && bestArtifact) {
    finalMemo = bestArtifact.memo;
  }

  let legalClaimValidation = await validateLegalClaimsWithOpenAI({
    input: workingInput,
    finalMemo,
    reasoningArtifacts,
    assessments: reasoningAssessments,
    conflictMatrix: reasoningConflictMatrix,
    freshnessScan: legalFreshnessScan,
  }).catch(() => null);

  const highRiskProviderConflicts = detectHighRiskProviderConflict(reasoningArtifacts);

  if (highRiskProviderConflicts.length && finalMemo) {
    finalMemo = await rewriteFinalMemoConservativelyWithOpenAI({
      input: workingInput,
      finalMemo,
      reasoningArtifacts,
      assessments: reasoningAssessments,
      conflictMatrix: reasoningConflictMatrix,
      legalClaimValidation,
      highRiskProviderConflicts,
      freshnessScan: legalFreshnessScan,
    }).catch(() => finalMemo);

    // Re-validate the rewritten memo. If the rewrite fixed the issue, the cap may loosen,
    // but provider conflict still prevents unsupported high confidence below.
    legalClaimValidation = await validateLegalClaimsWithOpenAI({
      input: workingInput,
      finalMemo,
      reasoningArtifacts,
      assessments: reasoningAssessments,
      conflictMatrix: reasoningConflictMatrix,
      freshnessScan: legalFreshnessScan,
    }).catch(() => legalClaimValidation);
  }

  const answer =
    finalMemo?.answer ||
    bestArtifact?.memo.answer ||
    `I couldn't get a successful provider response yet. Providers attempted: ${attempted
      .map((a) => `${a.provider}:${a.model}`)
      .join(", ")}`;

  const claimStability = evaluateClaimStability(reasoningConflictMatrix);
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
    ...(pipelineDecision.mode === "fast_consensus"
      ? [
          "Strong initial cross-model convergence was detected, so deeper escalation was not required for this issue.",
        ]
      : []),
    ...(claimStability.some((x) => x.critical && x.unstable)
      ? [
          "Some controlling mechanical claims remained unresolved after the challenge-back round; those claims were excluded from final synthesis rather than narrated as fact.",
        ]
      : []),
    ...(legalFreshnessScan?.confidence_impact === "high"
      ? [
          "Recent-law sensitivity was detected. The answer should distinguish current law from recently enacted, proposed, or future-effective changes.",
        ]
      : []),
    ...(legalFreshnessScan?.risk_flags || []),
    ...freshnessEnforcementCaveat(legalFreshnessScan, finalMemo),
    ...legalClaimValidationCaveats(legalClaimValidation),
    ...(highRiskProviderConflicts.length
      ? [
          "A conservative rewrite pass was applied because provider outputs materially conflicted on high-risk statutory, rate, effective-date, or compliance claims.",
        ]
      : []),
    ...highRiskConflictCaveats(highRiskProviderConflicts),
  ]);

  const followups = uniq([
    ...(finalMemo?.required_confirmations || []),
    ...(legalFreshnessScan?.recent_enacted_changes || []).map(
      (x) => `Confirm current enacted-law treatment and effective date: ${x}`
    ),
    ...(legalFreshnessScan?.pending_or_proposed_changes || []).map(
      (x) => `Do not rely on proposed-law treatment unless enacted: ${x}`
    ),
    ...(legalFreshnessScan?.effective_dates || []).map(
      (x) => `Verify effective date / transition rule: ${x}`
    ),
    ...legalClaimValidationFollowups(legalClaimValidation),
    ...highRiskConflictFollowups(highRiskProviderConflicts),
    ...survivingClaims.excludedCriticalClaims.map(
      (x) => `Resolve excluded controlling issue before relying on precise treatment: ${x}`
    ),
  ]);

  let confidence: "low" | "medium" | "high" =
    finalMemo?.confidence ||
    (selectedRound1.length >= 3 ? "medium" : "low");

  const unresolvedControllingCount = claimStability.filter(
    (x) => x.critical && x.unstable
  ).length;

  if (unresolvedControllingCount >= 1) confidence = "low";
  else if (selectedRound1.length < 2) confidence = "low";
  else {
    confidence = applyConfidenceCap(
      confidence,
      freshnessConfidenceCap(legalFreshnessScan, finalMemo)
    );

    confidence = applyConfidenceCap(
      confidence,
      legalClaimValidation?.confidence_cap || "high"
    );

    if (highRiskProviderConflicts.length) {
      confidence = applyConfidenceCap(
        confidence,
        finalMemoStatesAggressiveHighRiskLiability(finalMemo) ? "low" : "medium"
      );
    }

    if (
      pipelineDecision.mode === "fast_consensus" &&
      confidence === "low" &&
      legalClaimValidation?.severity !== "critical" &&
      !highRiskProviderConflicts.length
    ) {
      confidence = "medium";
    }
  }

  const runtime_ms = Date.now() - t0;

  console.log("[crosscheck] pipeline", {
    requestedMode: deepRun ? "deep" : "fast",
    minSuccessfulProviders,
    legalFreshnessImpact: legalFreshnessScan?.confidence_impact || "none",
    finalMemoAddressesFreshness: finalMemoAddressesFreshness(finalMemo, legalFreshnessScan),
    freshnessConfidenceCap: freshnessConfidenceCap(legalFreshnessScan, finalMemo),
    legalClaimValidationSeverity: legalClaimValidation?.severity || "none",
    legalClaimConfidenceCap: legalClaimValidation?.confidence_cap || "high",
    highRiskProviderConflictCount: highRiskProviderConflicts.length,
    conservativeRewriteApplied: highRiskProviderConflicts.length > 0,
    finalMemoStatesAggressiveHighRiskLiability: finalMemoStatesAggressiveHighRiskLiability(finalMemo),
    mode: pipelineDecision.mode,
    reasons: pipelineDecision.reasons,
    runtime_ms,
    attempted: attempted.length,
    succeeded: succeededCalls.length,
  });

  return {
    ok: !!succeededCalls.length,
    meta: {
      attempted,
      succeeded: succeededCalls,
      failed: failedCalls,
      runtime_ms,
      pipeline: {
        mode: pipelineDecision.mode,
        reasons: [
          ...(deepRun
            ? [
                `Deep Mode requested: target ${minSuccessfulProviders} successful providers before confidence scoring.`,
              ]
            : [
                `Fast Mode requested: target ${minSuccessfulProviders} successful providers before confidence scoring.`,
              ]),
          ...(legalFreshnessScan
            ? [
                `Legal freshness scan: ${legalFreshnessScan.confidence_impact} confidence impact.`,
              ]
            : []),
          ...(legalClaimValidation
            ? [
                `Legal claim validation: ${legalClaimValidation.severity} severity; confidence cap ${legalClaimValidation.confidence_cap}.`,
              ]
            : []),
          ...(highRiskProviderConflicts.length
            ? [
                `High-risk provider conflict gate triggered: ${highRiskProviderConflicts.length} issue(s).`,
                "Conservative rewrite pass applied before final delivery.",
              ]
            : []),
          ...pipelineDecision.reasons,
        ],
      },
    } as CrosscheckResult["meta"] & {
      pipeline?: {
        mode: PipelineMode;
        reasons: string[];
      };
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
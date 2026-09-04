import type {
  CrosscheckInput,
  CrosscheckResult,
  IssueResolution,
  ProviderCall,
  ProviderOutput,
  IssueProviderPosition,
  ResolutionStatus,
} from "./types";
import { callOpenAI } from "./providers/openai";
import { callOpenRouter } from "./providers/openrouter";
import { callGemini } from "./providers/gemini";
import { callAnthropic } from "./providers/anthropic";
import OpenAI from "openai";
import {
  formatAuthorityContext,
  retrieveAuthority,
} from "../retrieval/authority";
import { escalateSevereIssueConflicts } from "../research/escalation";

function env(name: string): string {
  return process.env[name] || "";
}

function uniq(xs: string[]): string[] {
  return Array.from(new Set(xs.map((x) => String(x).trim()).filter(Boolean)));
}


function inferResponseLanguage(input: CrosscheckInput): string {
  const explicit = String(input.responseLanguage || "").trim();
  if (explicit) return explicit;

  const sample = `${input.question || ""}\n${input.facts || ""}`.toLowerCase();

  const portugueseSignals = [
    "ção", "ções", "não", "você", "vocês", "qual", "quais", "empresa",
    "brasil", "brasileira", "tributário", "imposto", "receita federal",
    "fiscal", "jurídico", "ltda", "eua", "prestação", "serviços"
  ];

  const spanishSignals = [
    "ción", "ciones", "qué", "cuál", "cuáles", "empresa",
    "impuesto", "tributario", "españa", "méxico", "servicios",
    "jurídico", "fiscal", "ee.uu"
  ];

  const ptScore = portugueseSignals.filter((s) => sample.includes(s)).length;
  const esScore = spanishSignals.filter((s) => sample.includes(s)).length;

  if (ptScore >= 2 && ptScore >= esScore) return "Portuguese";
  if (esScore >= 2 && esScore > ptScore) return "Spanish";

  return "English";
}

function responseLanguageInstruction(input: CrosscheckInput): string {
  const language = inferResponseLanguage(input);
  return [
    `Response language requirement: write the entire answer in ${language}.`,
    "Use the same language as the user's original question unless an explicit response language is provided.",
    "Do not switch to English merely because tax terms, statutes, forms, or provider outputs are in English.",
    "Keep official form names, statute names, entity names, and proper nouns in their official language where appropriate, but explain them in the response language.",
  ].join("\\n");
}



function treatyReliabilityInstruction(): string {
  return [
    "Treaty reliability requirement:",
    "- Do not state, assume, name, cite, or apply an income tax treaty unless treaty existence is expressly supplied in the user facts, attached documents, or verified source material available in the prompt.",
    "- Do not invent treaty names, signature dates, entry-into-force dates, treaty articles, limitation-on-benefits rules, permanent establishment protections, or reduced withholding rates.",
    "- If treaty availability is relevant but not verified, state that treaty applicability must be confirmed and analyze the domestic-law position first.",
    "- If providers disagree on treaty availability, treat the treaty position as unresolved and do not use it as a settled conclusion.",
    "- Prefer conservative domestic-law analysis unless treaty support is verified.",
  ].join("\n");
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

function issueId(prefix: string, value: string, index: number): string {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

  return `${prefix}_${slug || index + 1}`;
}

type ControllingClaimCandidate = {
  claim_id: string;
  provider: string;
  model: string;
  statement: string;
  topic: string;
  confidence: "low" | "medium" | "high";
  applies_to: string[];
};

type SemanticClaimGroup = {
  issue_label: string;
  issue_statement: string;
  claim_ids: string[];
  relationship: "aligned" | "conflicting" | "mixed";
  reasoning: string;
};

type SemanticClaimGroupingJson = {
  groups?: Array<{
    issue_label?: string;
    issue_statement?: string;
    claim_ids?: unknown;
    relationship?: string;
    reasoning?: string;
  }>;
};

function normalizeClaimConfidence(
  value: unknown
): "low" | "medium" | "high" {
  const v = String(value || "").trim().toLowerCase();
  if (v === "low" || v === "high") return v;
  return "medium";
}

function normalizeAppliesTo(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniq(
      value.map((x) => String(x || "").trim()).filter(Boolean)
    );
  }

  const single = String(value || "").trim();
  return single ? [single] : [];
}

function collectControllingClaimCandidates(
  artifacts: ProviderMemoArtifact[]
): ControllingClaimCandidate[] {
  const candidates: ControllingClaimCandidate[] = [];
  let counter = 1;

  for (const artifact of artifacts) {
    for (const claim of artifact.memo.claims || []) {
      if (!claim?.controlling) continue;

      const statement = String(claim.statement || "").trim();
      if (!statement) continue;

      candidates.push({
        claim_id: `c${counter++}`,
        provider: artifact.provider,
        model: artifact.model,
        statement,
        topic: String(claim.topic || "").trim(),
        confidence: normalizeClaimConfidence(claim.confidence),
        applies_to: normalizeAppliesTo(claim.applies_to),
      });
    }
  }

  return candidates;
}

function buildConsolidatedIssueFromGroup(args: {
  group: SemanticClaimGroup;
  claimsById: Map<string, ControllingClaimCandidate>;
  index: number;
}): IssueResolution | null {
  const claims = args.group.claim_ids
    .map((id) => args.claimsById.get(id))
    .filter(Boolean) as ControllingClaimCandidate[];

  if (!claims.length) return null;

  const positions: IssueProviderPosition[] = claims.map((claim) => ({
    provider: claim.provider,
    model: claim.model,
    position: claim.statement,
    confidence: claim.confidence,
  }));

  const distinctPositions = uniq(
    claims.map((claim) => claim.statement)
  );

  const relationship =
    args.group.relationship === "conflicting" ||
    args.group.relationship === "mixed"
      ? args.group.relationship
      : "aligned";

  const unresolved =
    relationship !== "aligned" && distinctPositions.length > 1;

  const issueStatement =
    String(args.group.issue_statement || "").trim() ||
    String(args.group.issue_label || "").trim() ||
    claims[0].topic ||
    claims[0].statement;

  const issueLabel =
    String(args.group.issue_label || "").trim() ||
    issueStatement;

  return {
    issue_id: issueId(
      "provider_semantic",
      issueStatement,
      args.index
    ),
    issue_label: issueLabel,
    issue_statement: issueStatement,
    provider_positions: positions,
    status: unresolved ? "unresolved" : "supported",
    resolved_position:
      unresolved || !distinctPositions.length
        ? undefined
        : distinctPositions[0],
    reasoning:
      String(args.group.reasoning || "").trim() ||
      (unresolved
        ? "Multiple controlling provider claims address the same underlying issue but reach materially different positions. The issue must be adjudicated rather than treated as consensus."
        : "Controlling provider claims were semantically consolidated into one underlying issue. Provider convergence is provisional support only and does not constitute authority verification."),
    controlling: true,
    missing_facts: [],
    disagreements: unresolved ? distinctPositions : [],
    rejected_positions: [],
    confidence: unresolved ? "low" : "medium",
  };
}

function normalizeIssueIdentityText(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/§/g, " section ")
    .replace(/\bsec(?:tion)?\.?\s*/g, " section ")
    .replace(/\birc\b/g, " internal revenue code ")
    .replace(/\bu\.?s\.?c\.?\b/g, " code ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function issueIdentityTokens(value: unknown): string[] {
  const stop = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "been",
    "being",
    "by",
    "for",
    "from",
    "has",
    "have",
    "in",
    "into",
    "is",
    "it",
    "its",
    "may",
    "of",
    "on",
    "or",
    "that",
    "the",
    "their",
    "this",
    "to",
    "under",
    "was",
    "were",
    "whether",
    "which",
    "with",
    "would",
    "tax",
    "taxes",
    "taxpayer",
    "rule",
    "rules",
    "treatment",
    "amount",
    "calculation",
    "calculate",
    "computed",
    "compute",
    "determination",
    "determine",
    "application",
    "applies",
    "applicable",
  ]);

  return uniq(
    normalizeIssueIdentityText(value)
      .split(" ")
      .filter((token) => token.length >= 2 && !stop.has(token))
  ).sort();
}

function extractIssueLegalAnchors(value: unknown): string[] {
  const text = normalizeIssueIdentityText(value);
  const anchors = new Set<string>();

  const sectionPattern =
    /\bsection\s+([0-9]{1,4}[a-z]?)\b/g;

  for (const match of text.matchAll(sectionPattern)) {
    const normalized = String(match[1] || "")
      .replace(/\s+/g, "")
      .trim();

    if (normalized) {
      anchors.add(`section:${normalized}`);
    }
  }

  const formPattern =
    /\bform\s+([0-9]{3,5}[a-z]?)\b/g;

  for (const match of text.matchAll(formPattern)) {
    const normalized = String(match[1] || "").trim();
    if (normalized) {
      anchors.add(`form:${normalized}`);
    }
  }

  return Array.from(anchors).sort();
}

function buildClaimIssueIdentity(claim: ControllingClaimCandidate): {
  descriptor: string;
  tokens: string[];
  legalAnchors: string[];
  scopeTokens: string[];
} {
  const descriptor = [
    claim.topic,
    ...claim.applies_to,
    claim.statement,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    descriptor,
    tokens: issueIdentityTokens(descriptor),
    legalAnchors: extractIssueLegalAnchors(descriptor),
    scopeTokens: issueIdentityTokens(
      [claim.topic, ...claim.applies_to]
        .filter(Boolean)
        .join(" ")
    ),
  };
}

function tokenOverlapRatio(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;

  const aa = new Set(a);
  const bb = new Set(b);

  let intersection = 0;

  for (const token of aa) {
    if (bb.has(token)) intersection++;
  }

  return intersection / Math.min(aa.size, bb.size);
}

function tokenJaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;

  const aa = new Set(a);
  const bb = new Set(b);

  let intersection = 0;

  for (const token of aa) {
    if (bb.has(token)) intersection++;
  }

  const union = new Set([...aa, ...bb]).size;
  return union ? intersection / union : 0;
}

function shareIssueAnchor(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;

  const bb = new Set(b);
  return a.some((anchor) => bb.has(anchor));
}

function claimsShareDeterministicIssue(
  a: ControllingClaimCandidate,
  b: ControllingClaimCandidate
): boolean {
  const ai = buildClaimIssueIdentity(a);
  const bi = buildClaimIssueIdentity(b);

  const sharedLegalAnchor = shareIssueAnchor(
    ai.legalAnchors,
    bi.legalAnchors
  );

  const scopeOverlap = tokenOverlapRatio(
    ai.scopeTokens,
    bi.scopeTokens
  );

  const overallOverlap = tokenOverlapRatio(
    ai.tokens,
    bi.tokens
  );

  const jaccard = tokenJaccard(
    ai.tokens,
    bi.tokens
  );

  // Same explicit legal/form anchor plus meaningful semantic overlap.
  if (
    sharedLegalAnchor &&
    overallOverlap >= 0.30 &&
    (jaccard >= 0.16 || scopeOverlap >= 0.34)
  ) {
    return true;
  }

  // Strong provider-declared scope overlap is useful only when the
  // substantive claim language also overlaps. Shared parties alone
  // (for example, "U.S. parent") must never collapse unrelated issues.
  if (
    ai.scopeTokens.length &&
    bi.scopeTokens.length &&
    scopeOverlap >= 0.72 &&
    overallOverlap >= 0.38 &&
    jaccard >= 0.20
  ) {
    return true;
  }

  // Strong overall lexical-semantic identity.
  if (
    overallOverlap >= 0.72 &&
    jaccard >= 0.42
  ) {
    return true;
  }

  return false;
}

function canonicalIssueLabel(
  bucket: ControllingClaimCandidate[]
): string {
  const topicCounts = new Map<string, number>();

  for (const claim of bucket) {
    const topic = String(claim.topic || "").trim();
    if (!topic) continue;

    const key = normalizeIssueIdentityText(topic);
    if (!key) continue;

    topicCounts.set(key, (topicCounts.get(key) || 0) + 1);
  }

  const rankedTopics = Array.from(topicCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  if (rankedTopics.length) {
    const winner = rankedTopics[0][0];

    const original = bucket
      .map((claim) => String(claim.topic || "").trim())
      .find(
        (topic) =>
          normalizeIssueIdentityText(topic) === winner
      );

    if (original) return original;
  }

  const scoped = bucket
    .flatMap((claim) => claim.applies_to)
    .map((x) => String(x || "").trim())
    .find(Boolean);

  if (scoped) return scoped;

  return bucket[0]?.statement || "Controlling legal issue";
}

function fallbackSemanticGroups(
  claims: ControllingClaimCandidate[]
): SemanticClaimGroup[] {
  if (!claims.length) return [];

  // Phase 3G:
  // Build deterministic connected components of claims that appear to answer
  // the same underlying issue. This fallback must remain useful even when the
  // model-based semantic clustering stage is unavailable or malformed.
  //
  // Importantly, this does NOT decide which legal position is correct.
  // It only prevents materially competing positions from escaping into
  // separate "supported" ledger entries because providers used different
  // labels for the same issue.

  const parent = claims.map((_, index) => index);

  const find = (index: number): number => {
    let current = index;

    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }

    return current;
  };

  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);

    if (ra !== rb) {
      parent[rb] = ra;
    }
  };

  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      if (claimsShareDeterministicIssue(claims[i], claims[j])) {
        union(i, j);
      }
    }
  }

  const buckets = new Map<number, ControllingClaimCandidate[]>();

  claims.forEach((claim, index) => {
    const root = find(index);
    const bucket = buckets.get(root) || [];
    bucket.push(claim);
    buckets.set(root, bucket);
  });

  return Array.from(buckets.values()).map((bucket) => {
    const positions = uniq(
      bucket.map((claim) => claim.statement)
    );

    const label = canonicalIssueLabel(bucket);

    return {
      issue_label: label,
      issue_statement: label,
      claim_ids: bucket.map((claim) => claim.claim_id),

      // Deterministic fallback is deliberately conservative:
      // distinct controlling positions inside the same canonical issue
      // are not consensus merely because providers broadly agree elsewhere.
      relationship:
        positions.length > 1 ? "mixed" : "aligned",

      reasoning:
        positions.length > 1
          ? "Model-based semantic clustering was unavailable or unusable. Deterministic issue-identity normalization grouped materially related controlling claims into the same issue. Because distinct positions remain, the issue is treated as unresolved pending adjudication or authority verification."
          : "Model-based semantic clustering was unavailable or unusable. Deterministic issue-identity normalization retained this controlling position as provisionally supported pending authority verification.",
    };
  });
}

function resolutionPositionSignature(
  issue: IssueResolution
): string {
  return uniq(
    issue.provider_positions
      .map((position) =>
        normalizeIssueIdentityText(position.position)
      )
      .filter(Boolean)
  )
    .sort()
    .join("||");
}

function resolutionCanonicalKey(
  issue: IssueResolution
): string {
  const id = normalizeIssueIdentityText(issue.issue_id);
  const label = normalizeIssueIdentityText(
    issue.issue_label || issue.issue_statement
  );
  const positions = resolutionPositionSignature(issue);

  // Exact canonical IDs are strongest. Position signature provides a
  // deterministic backstop when equivalent issues received slightly
  // different generated labels.
  return id || `${label}::${positions}`;
}

function mostConservativeMergedStatus(
  issues: IssueResolution[]
): ResolutionStatus {
  const statuses = new Set(
    issues.map((issue) => issue.status)
  );

  if (statuses.has("unresolved")) {
    return "unresolved";
  }

  // A rejected position mixed with any surviving position is itself a
  // conflict, not a basis for selecting either side.
  if (
    statuses.has("rejected") &&
    statuses.size > 1
  ) {
    return "unresolved";
  }

  if (
    statuses.size === 1 &&
    statuses.has("rejected")
  ) {
    return "rejected";
  }

  if (statuses.has("fact_dependent")) {
    return "fact_dependent";
  }

  // Verified survives only when every duplicate copy is verified.
  if (
    statuses.size === 1 &&
    statuses.has("verified")
  ) {
    return "verified";
  }

  return "supported";
}

function mergeDuplicateIssueResolutions(
  issues: IssueResolution[]
): IssueResolution[] {
  const groups = new Map<string, IssueResolution[]>();

  for (const issue of issues) {
    const key = resolutionCanonicalKey(issue);
    const bucket = groups.get(key) || [];
    bucket.push(issue);
    groups.set(key, bucket);
  }

  return Array.from(groups.values()).map((members) => {
    if (members.length === 1) {
      return members[0];
    }

    const base = members[0];
    const status = mostConservativeMergedStatus(members);

    const providerPositions = Array.from(
      new Map(
        members
          .flatMap((issue) => issue.provider_positions)
          .map((position) => [
            [
              position.provider,
              position.model,
              normalizeIssueIdentityText(position.position),
            ].join("::"),
            position,
          ])
      ).values()
    );

    const distinctResolvedPositions = uniq(
      members
        .map((issue) =>
          String(issue.resolved_position || "").trim()
        )
        .filter(Boolean)
    );

    const allDisagreements = uniq([
      ...members.flatMap((issue) => issue.disagreements),
      ...(status === "unresolved"
        ? providerPositions.map(
            (position) => position.position
          )
        : []),
    ]);

    const allMissingFacts = uniq(
      members.flatMap((issue) => issue.missing_facts)
    );

    const allRejectedPositions = uniq(
      members.flatMap(
        (issue) => issue.rejected_positions
      )
    );

    const authorityValidations = members
      .map((issue) => issue.authority_validation)
      .filter(Boolean);

    const authorityValidation =
      authorityValidations.find(
        (validation) =>
          validation?.verdict === "insufficient"
      ) ||
      authorityValidations.find(
        (validation) =>
          validation?.verdict === "contradicted"
      ) ||
      authorityValidations[0];

    const canKeepResolvedPosition =
      (status === "verified" ||
        status === "supported") &&
      distinctResolvedPositions.length === 1;

    return {
      ...base,
      provider_positions: providerPositions,
      status,
      resolved_position: canKeepResolvedPosition
        ? distinctResolvedPositions[0]
        : undefined,
      reasoning: uniq(
        members
          .map((issue) => issue.reasoning)
          .filter(Boolean)
      ).join(
        " | "
      ) +
        " | Duplicate canonical ledger entries were merged before final synthesis.",
      controlling: members.some(
        (issue) => issue.controlling
      ),
      missing_facts: allMissingFacts,
      disagreements: allDisagreements,
      rejected_positions: allRejectedPositions,
      confidence:
        status === "verified"
          ? "high"
          : status === "supported"
          ? "medium"
          : "low",
      ...(authorityValidation
        ? { authority_validation: authorityValidation }
        : {}),
    };
  });
}

function issueResolutionIdentity(
  issue: IssueResolution
): {
  tokens: string[];
  legalAnchors: string[];
} {
  const descriptor = [
    issue.issue_label,
    issue.issue_statement,
    issue.resolved_position || "",
    ...issue.provider_positions.map(
      (position) => position.position
    ),
  ]
    .filter(Boolean)
    .join(" ");

  return {
    tokens: issueIdentityTokens(descriptor),
    legalAnchors:
      extractIssueLegalAnchors(descriptor),
  };
}

function issueResolutionsCloselyRelated(
  a: IssueResolution,
  b: IssueResolution
): boolean {
  if (a.issue_id === b.issue_id) return true;

  const ai = issueResolutionIdentity(a);
  const bi = issueResolutionIdentity(b);

  const overlap = tokenOverlapRatio(
    ai.tokens,
    bi.tokens
  );

  const jaccard = tokenJaccard(
    ai.tokens,
    bi.tokens
  );

  const sharedAnchor = shareIssueAnchor(
    ai.legalAnchors,
    bi.legalAnchors
  );

  // This relationship test is intentionally stricter than Phase 3G
  // claim grouping. Phase 3H is only preventing a narrow supported
  // proposition from silently overriding an already-blocking parent issue.
  if (
    sharedAnchor &&
    overlap >= 0.46 &&
    jaccard >= 0.22
  ) {
    return true;
  }

  if (
    overlap >= 0.82 &&
    jaccard >= 0.52
  ) {
    return true;
  }

  return false;
}

function protectBlockingParentIssues(
  issues: IssueResolution[]
): IssueResolution[] {
  const blockers = issues.filter(
    (issue) =>
      issue.controlling &&
      (
        issue.status === "unresolved" ||
        issue.status === "fact_dependent" ||
        issue.status === "rejected"
      )
  );

  if (!blockers.length) return issues;

  return issues.map((issue) => {
    // Authority-verified propositions remain verified.
    if (
      !issue.controlling ||
      issue.status !== "supported"
    ) {
      return issue;
    }

    const relatedBlocker = blockers.find(
      (blocker) =>
        blocker.issue_id !== issue.issue_id &&
        issueResolutionsCloselyRelated(
          issue,
          blocker
        )
    );

    if (!relatedBlocker) {
      return issue;
    }

    return {
      ...issue,
      status: "fact_dependent",
      resolved_position: undefined,
      reasoning:
        `${issue.reasoning} | This provisionally supported proposition is closely related to unresolved controlling issue "${relatedBlocker.issue_label}" and therefore cannot independently settle the broader legal result.`,
      missing_facts: uniq([
        ...issue.missing_facts,
        ...relatedBlocker.missing_facts,
        `Resolve related controlling issue before reliance: ${relatedBlocker.issue_label}`,
      ]),
      disagreements: uniq([
        ...issue.disagreements,
        ...relatedBlocker.disagreements,
      ]),
      confidence: "low",
    };
  });
}

type LedgerRelation =
  | "same_issue_aligned"
  | "same_issue_conflicting"
  | "parent_child"
  | "unrelated";

type LedgerRelationJson = {
  relations?: Array<{
    issue_a?: string;
    issue_b?: string;
    relation?: string;
    reasoning?: string;
  }>;
};

function issueResolutionDescriptor(
  issue: IssueResolution
): string {
  return [
    issue.issue_label,
    issue.issue_statement,
    issue.resolved_position || "",
    ...issue.provider_positions.map(
      (position) => position.position
    ),
    ...issue.disagreements,
  ]
    .filter(Boolean)
    .join(" ");
}

function issueResolutionSemanticTokens(
  issue: IssueResolution
): string[] {
  return issueIdentityTokens(
    issueResolutionDescriptor(issue)
  );
}

function issueResolutionNegationSignals(
  issue: IssueResolution
): Set<string> {
  const text = normalizeIssueIdentityText(
    issueResolutionDescriptor(issue)
  );

  const signals = new Set<string>();

  const patterns: Array<[RegExp, string]> = [
    [/\bno\b|\bnot\b|\bnone\b|\bwithout\b/, "negative"],
    [/\btaxable\b/, "taxable"],
    [/\bnontaxable\b|\bnon taxable\b|\btax free\b/, "nontaxable"],
    [/\bapplies\b|\bapplicable\b/, "applies"],
    [/\bdoes not apply\b|\bnot applicable\b|\bunavailable\b/, "does_not_apply"],
    [/\brequired\b|\bmust\b/, "required"],
    [/\bnot required\b|\boptional\b/, "not_required"],
    [/\ballowed\b|\bavailable\b|\beligible\b/, "allowed"],
    [/\bdisallowed\b|\bineligible\b|\bnot available\b/, "disallowed"],
  ];

  for (const [pattern, signal] of patterns) {
    if (pattern.test(text)) signals.add(signal);
  }

  return signals;
}

function hasOpposingLegalSignals(
  a: IssueResolution,
  b: IssueResolution
): boolean {
  const aa = issueResolutionNegationSignals(a);
  const bb = issueResolutionNegationSignals(b);

  const opposingPairs: Array<[string, string]> = [
    ["taxable", "nontaxable"],
    ["applies", "does_not_apply"],
    ["required", "not_required"],
    ["allowed", "disallowed"],
  ];

  return opposingPairs.some(
    ([left, right]) =>
      (aa.has(left) && bb.has(right)) ||
      (aa.has(right) && bb.has(left))
  );
}

function sharedMaterialNumbers(
  a: IssueResolution,
  b: IssueResolution
): number {
  const extract = (value: string): Set<string> => {
    const matches =
      value.match(/\b\d+(?:\.\d+)?%|\$?\d+(?:,\d{3})*(?:\.\d+)?[mkb]?\b/gi) ||
      [];

    return new Set(
      matches.map((x) =>
        x.toLowerCase().replace(/,/g, "")
      )
    );
  };

  const aa = extract(issueResolutionDescriptor(a));
  const bb = extract(issueResolutionDescriptor(b));

  let shared = 0;

  for (const value of aa) {
    if (bb.has(value)) shared++;
  }

  return shared;
}

function normalizePositionForEquivalence(
  value: unknown
): string {
  return normalizeIssueIdentityText(value)
    .replace(/\bapproximately\b/g, "")
    .replace(/\bapprox\b/g, "")
    .replace(/\bgenerally\b/g, "")
    .replace(/\blikely\b/g, "")
    .replace(/\bpotentially\b/g, "")
    .replace(/\bmay\b/g, "")
    .replace(/\bsubject to\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function positionEquivalenceTokens(
  value: unknown
): string[] {
  return issueIdentityTokens(
    normalizePositionForEquivalence(value)
  );
}

function positionsMateriallyEquivalent(
  a: string,
  b: string
): boolean {
  const aa = normalizePositionForEquivalence(a);
  const bb = normalizePositionForEquivalence(b);

  if (!aa || !bb) return false;
  if (aa === bb) return true;

  const tokensA = positionEquivalenceTokens(a);
  const tokensB = positionEquivalenceTokens(b);

  const overlap = tokenOverlapRatio(
    tokensA,
    tokensB
  );

  const jaccard = tokenJaccard(
    tokensA,
    tokensB
  );

  const anchorsA = extractIssueLegalAnchors(a);
  const anchorsB = extractIssueLegalAnchors(b);

  const sharedAnchor = shareIssueAnchor(
    anchorsA,
    anchorsB
  );

  const opposing =
    hasOpposingLegalSignals(
      {
        issue_id: "a",
        issue_label: "",
        issue_statement: a,
        provider_positions: [],
        status: "supported",
        resolved_position: a,
        reasoning: "",
        controlling: true,
        missing_facts: [],
        disagreements: [],
        rejected_positions: [],
        confidence: "medium",
      } as IssueResolution,
      {
        issue_id: "b",
        issue_label: "",
        issue_statement: b,
        provider_positions: [],
        status: "supported",
        resolved_position: b,
        reasoning: "",
        controlling: true,
        missing_facts: [],
        disagreements: [],
        rejected_positions: [],
        confidence: "medium",
      } as IssueResolution
    );

  if (opposing) return false;

  if (
    sharedAnchor &&
    overlap >= 0.62 &&
    jaccard >= 0.34
  ) {
    return true;
  }

  if (
    overlap >= 0.84 &&
    jaccard >= 0.58
  ) {
    return true;
  }

  return false;
}

function collapseEquivalentProviderPositions(
  positions: IssueProviderPosition[]
): IssueProviderPosition[] {
  const buckets: IssueProviderPosition[][] = [];

  for (const position of positions) {
    const existing = buckets.find((bucket) =>
      bucket.every((candidate) =>
        positionsMateriallyEquivalent(
          candidate.position,
          position.position
        )
      )
    );

    if (existing) {
      existing.push(position);
    } else {
      buckets.push([position]);
    }
  }

  return buckets.map((bucket) => {
    const representative =
      bucket
        .slice()
        .sort(
          (a, b) =>
            String(b.position || "").length -
            String(a.position || "").length
        )[0];

    return {
      ...representative,
      position: representative.position,
      confidence:
        bucket.some(
          (x) => x.confidence === "high"
        )
          ? "high"
          : bucket.some(
              (x) => x.confidence === "medium"
            )
          ? "medium"
          : representative.confidence,
    };
  });
}

function issueCoreIdentity(
  issue: IssueResolution
): {
  labelTokens: string[];
  positionTokens: string[];
  anchors: string[];
} {
  const labelText = [
    issue.issue_label,
    issue.issue_statement,
  ]
    .filter(Boolean)
    .join(" ");

  const positionText = [
    issue.resolved_position || "",
    ...issue.provider_positions.map(
      (position) => position.position
    ),
  ]
    .filter(Boolean)
    .join(" ");

  return {
    labelTokens:
      issueIdentityTokens(labelText),
    positionTokens:
      issueIdentityTokens(positionText),
    anchors:
      extractIssueLegalAnchors(
        `${labelText} ${positionText}`
      ),
  };
}

function areSameLegalSubissue(
  a: IssueResolution,
  b: IssueResolution
): boolean {
  if (a.issue_id === b.issue_id) {
    return true;
  }

  const ai = issueCoreIdentity(a);
  const bi = issueCoreIdentity(b);

  const labelOverlap =
    tokenOverlapRatio(
      ai.labelTokens,
      bi.labelTokens
    );

  const labelJaccard =
    tokenJaccard(
      ai.labelTokens,
      bi.labelTokens
    );

  const positionOverlap =
    tokenOverlapRatio(
      ai.positionTokens,
      bi.positionTokens
    );

  const positionJaccard =
    tokenJaccard(
      ai.positionTokens,
      bi.positionTokens
    );

  const sharedAnchor =
    shareIssueAnchor(
      ai.anchors,
      bi.anchors
    );

  // Strong label identity.
  if (
    labelOverlap >= 0.80 &&
    labelJaccard >= 0.50
  ) {
    return true;
  }

  // Same explicit legal provision plus strong outcome similarity.
  if (
    sharedAnchor &&
    positionOverlap >= 0.68 &&
    positionJaccard >= 0.38
  ) {
    return true;
  }

  // Strong position identity plus at least some label similarity.
  if (
    positionOverlap >= 0.86 &&
    positionJaccard >= 0.58 &&
    labelOverlap >= 0.38
  ) {
    return true;
  }

  return false;
}

function refineIssueStatusesAfterEquivalence(
  issues: IssueResolution[]
): IssueResolution[] {
  return issues.map((issue) => {
    const collapsed =
      collapseEquivalentProviderPositions(
        issue.provider_positions
      );

    const uniquePositions =
      collapsed.map(
        (position) => position.position
      );

    const distinctResolved =
      uniq(
        [
          issue.resolved_position || "",
          ...uniquePositions,
        ]
          .filter(Boolean)
      );

    const hasMaterialConflict =
      uniquePositions.some((a, index) =>
        uniquePositions
          .slice(index + 1)
          .some(
            (b) =>
              !positionsMateriallyEquivalent(
                a,
                b
              )
          )
      );

    if (
      issue.status === "unresolved" &&
      !hasMaterialConflict
    ) {
      const best =
        uniquePositions[0] ||
        issue.resolved_position ||
        issue.issue_statement;

      return {
        ...issue,
        provider_positions: collapsed,
        status: "supported",
        resolved_position: best,
        disagreements: [],
        reasoning:
          `${issue.reasoning} | Phase 4 semantic-equivalence pass found no material conflict among the surviving provider positions; wording-only differences were collapsed.`,
        confidence: "medium",
      };
    }

    if (
      hasMaterialConflict
    ) {
      return {
        ...issue,
        provider_positions: collapsed,
        status: "unresolved",
        resolved_position: undefined,
        disagreements:
          uniq(uniquePositions),
        confidence: "low",
      };
    }

    return {
      ...issue,
      provider_positions: collapsed,
      resolved_position:
        issue.status === "supported" &&
        distinctResolved.length === 1
          ? distinctResolved[0]
          : issue.resolved_position,
    };
  });
}

function splitOverMergedIssueFamily(
  issue: IssueResolution
): IssueResolution[] {
  // Phase 4.1:
  // A Phase-4-created subissue is already at proposition granularity.
  // Never recursively split _sub_ issues into _sub_1_sub_1 chains.
  if (
    issue.issue_id.includes("_sub_") ||
    issue.provider_positions.length < 3
  ) {
    return [issue];
  }

  const buckets: IssueProviderPosition[][] = [];

  for (const position of issue.provider_positions) {
    const candidateIssue = {
      ...issue,
      issue_id: `${issue.issue_id}_candidate`,
      issue_label: position.position,
      issue_statement: position.position,
      provider_positions: [position],
      resolved_position: position.position,
      status: "supported",
    } as IssueResolution;

    const bucket = buckets.find((existing) =>
      existing.every((member) => {
        const memberIssue = {
          ...issue,
          issue_id: `${issue.issue_id}_member`,
          issue_label:
            member.position,
          issue_statement:
            member.position,
          provider_positions:
            [member],
          resolved_position:
            member.position,
          status: "supported",
        } as IssueResolution;

        return areSameLegalSubissue(
          memberIssue,
          candidateIssue
        );
      })
    );

    if (bucket) {
      bucket.push(position);
    } else {
      buckets.push([position]);
    }
  }

  if (buckets.length <= 1) {
    return [issue];
  }

  return buckets.map(
    (bucket, index) => {
      const label =
        bucket[0].position;

      const collapsed =
        collapseEquivalentProviderPositions(
          bucket
        );

      const hasConflict =
        collapsed.some((a, i) =>
          collapsed
            .slice(i + 1)
            .some(
              (b) =>
                !positionsMateriallyEquivalent(
                  a.position,
                  b.position
                )
            )
        );

      return {
        ...issue,
        issue_id:
          `${issue.issue_id}_sub_${index + 1}`,
        issue_label: label,
        issue_statement: label,
        provider_positions:
          collapsed,
        status:
          hasConflict
            ? "unresolved"
            : "supported",
        resolved_position:
          hasConflict
            ? undefined
            : collapsed[0]?.position,
        disagreements:
          hasConflict
            ? collapsed.map(
                (x) => x.position
              )
            : [],
        reasoning:
          `${issue.reasoning} | Phase 4 split an over-merged legal family into separately adjudicable subissues.`,
        confidence:
          hasConflict
            ? "low"
            : "medium",
      };
    }
  );
}

function normalizeLedgerIssueGranularity(
  issues: IssueResolution[]
): IssueResolution[] {
  const split =
    issues.flatMap(
      splitOverMergedIssueFamily
    );

  return refineIssueStatusesAfterEquivalence(
    split
  );
}

function blockedIssuePhrases(
  issue: IssueResolution
): string[] {
  return uniq(
    [
      issue.resolved_position || "",
      ...issue.provider_positions.map(
        (position) => position.position
      ),
      ...issue.disagreements,
    ]
      .map((x) => String(x || "").trim())
      .filter(Boolean)
  );
}

function memoContainsBlockedConclusion(
  memo: NormalizedMemo,
  issue: IssueResolution
): boolean {
  if (
    issue.status !== "unresolved" &&
    issue.status !== "fact_dependent" &&
    issue.status !== "rejected"
  ) {
    return false;
  }

  const memoText =
    normalizeIssueIdentityText(
      [
        memo.executive_summary,
        memo.analysis,
        memo.recommendation,
        ...memo.transaction_specific_treatment,
      ]
        .filter(Boolean)
        .join(" ")
    );

  if (!memoText) return false;

  return blockedIssuePhrases(issue)
    .some((phrase) => {
      const normalizedPhrase =
        normalizeIssueIdentityText(
          phrase
        );

      if (
        !normalizedPhrase ||
        normalizedPhrase.length < 18
      ) {
        return false;
      }

      if (
        memoText.includes(
          normalizedPhrase
        )
      ) {
        return true;
      }

      const phraseTokens =
        issueIdentityTokens(
          normalizedPhrase
        );

      const memoTokens =
        issueIdentityTokens(
          memoText
        );

      const overlap =
        tokenOverlapRatio(
          phraseTokens,
          memoTokens
        );

      return (
        phraseTokens.length >= 4 &&
        overlap >= 0.88
      );
    });
}

function enforceFinalMemoLedgerInvariant(
  memo: NormalizedMemo | null,
  issues: IssueResolution[]
): {
  safe: boolean;
  blockedIssueIds: string[];
} {
  if (!memo) {
    return {
      safe: true,
      blockedIssueIds: [],
    };
  }

  const blocked =
    issues
      .filter(
        (issue) =>
          issue.controlling &&
          memoContainsBlockedConclusion(
            memo,
            issue
          )
      )
      .map(
        (issue) => issue.issue_id
      );

  return {
    safe: blocked.length === 0,
    blockedIssueIds: blocked,
  };
}

type LedgerStructuralRelation =
  | "equivalent"
  | "complementary"
  | "conflicting"
  | "distinct";

type LedgerStructuralAuditJson = {
  relations?: Array<{
    issue_ids?: string[];
    relation?: LedgerStructuralRelation;
    reasoning?: string;
  }>;
};

function extractMaterialAssertionMarkers(
  value: unknown
): string[] {
  const text =
    normalizeIssueIdentityText(value);

  const markers = new Set<string>();

  const percentages =
    text.match(/\b\d+(?:\.\d+)?\s*percent\b/g) || [];

  for (const pct of percentages) {
    markers.add(
      `pct:${pct.replace(/\s+/g, "")}`
    );
  }

  const rawPercentages =
    String(value || "").match(
      /\b\d+(?:\.\d+)?%/g
    ) || [];

  for (const pct of rawPercentages) {
    markers.add(
      `pct:${pct.replace(/\s+/g, "")}`
    );
  }

  const money =
    String(value || "").match(
      /\$\s*\d+(?:,\d{3})*(?:\.\d+)?(?:\s*[mkb])?/gi
    ) || [];

  for (const amount of money) {
    markers.add(
      `money:${amount
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/,/g, "")}`
    );
  }

  const categories =
    text.match(
      /\bcategory\s+[0-9]+[a-z]?\b/g
    ) || [];

  for (const category of categories) {
    markers.add(
      `category:${category.replace(/\s+/g, "")}`
    );
  }

  return Array.from(markers).sort();
}

function markerFamily(
  marker: string
): string {
  const idx = marker.indexOf(":");
  return idx >= 0
    ? marker.slice(0, idx)
    : marker;
}

function hasContradictoryMaterialMarkers(
  a: unknown,
  b: unknown
): boolean {
  const aa =
    extractMaterialAssertionMarkers(a);

  const bb =
    extractMaterialAssertionMarkers(b);

  if (!aa.length || !bb.length) {
    return false;
  }

  const families =
    new Set([
      ...aa.map(markerFamily),
      ...bb.map(markerFamily),
    ]);

  for (const family of families) {
    const av = aa.filter(
      (x) => markerFamily(x) === family
    );

    const bv = bb.filter(
      (x) => markerFamily(x) === family
    );

    if (!av.length || !bv.length) {
      continue;
    }

    const intersection =
      av.some((x) => bv.includes(x));

    if (!intersection) {
      return true;
    }
  }

  return false;
}

function issueHasInternalMaterialContradiction(
  issue: IssueResolution
): boolean {
  if (!issue.resolved_position) {
    return false;
  }

  const labelStatement = [
    issue.issue_label,
    issue.issue_statement,
  ]
    .filter(Boolean)
    .join(" ");

  if (
    hasContradictoryMaterialMarkers(
      labelStatement,
      issue.resolved_position
    )
  ) {
    return true;
  }

  const labelIssue = {
    ...issue,
    issue_id: `${issue.issue_id}_label_check`,
    issue_label: "",
    issue_statement: labelStatement,
    provider_positions: [],
    resolved_position: labelStatement,
  } as IssueResolution;

  const resolvedIssue = {
    ...issue,
    issue_id: `${issue.issue_id}_resolved_check`,
    issue_label: "",
    issue_statement:
      issue.resolved_position,
    provider_positions: [],
    resolved_position:
      issue.resolved_position,
  } as IssueResolution;

  return hasOpposingLegalSignals(
    labelIssue,
    resolvedIssue
  );
}

function enforceInternalIssueConsistency(
  issues: IssueResolution[]
): IssueResolution[] {
  return issues.map((issue) => {
    if (
      issue.status !== "supported" &&
      issue.status !== "verified"
    ) {
      return issue;
    }

    if (
      !issueHasInternalMaterialContradiction(
        issue
      )
    ) {
      return issue;
    }

    return {
      ...issue,
      status: "unresolved",
      resolved_position: undefined,
      disagreements: uniq([
        ...issue.disagreements,
        issue.issue_statement,
        ...(issue.provider_positions || [])
          .map((x) => x.position),
      ]),
      reasoning:
        `${issue.reasoning} | Phase 4.1 detected a material contradiction between the issue label/statement and its purported resolved position. The issue was downgraded rather than allowing inconsistent rates, amounts, filing categories, or opposite outcomes to survive as supported.`,
      confidence: "low",
    };
  });
}

function normalizeStructuralRelation(
  value: unknown
): LedgerStructuralRelation {
  const v = String(value || "")
    .trim()
    .toLowerCase();

  if (
    v === "equivalent" ||
    v === "complementary" ||
    v === "conflicting" ||
    v === "distinct"
  ) {
    return v;
  }

  return "distinct";
}

async function auditLedgerStructureWithOpenAI(args: {
  input: CrosscheckInput;
  issues: IssueResolution[];
}): Promise<LedgerStructuralAuditJson | null> {
  const apiKey = env("OPENAI_API_KEY");

  if (
    !apiKey ||
    args.issues.length < 2
  ) {
    return null;
  }

  const model =
    env("OPENAI_LEDGER_AUDIT_MODEL") ||
    env("OPENAI_LEDGER_RELATION_MODEL") ||
    env("OPENAI_ISSUE_ADJUDICATOR_MODEL") ||
    env("OPENAI_MODEL") ||
    "gpt-4.1-mini";

  const client =
    new OpenAI({ apiKey });

  const compact = args.issues.map(
    (issue) => ({
      issue_id: issue.issue_id,
      issue_label: issue.issue_label,
      issue_statement:
        issue.issue_statement,
      status: issue.status,
      resolved_position:
        issue.resolved_position || null,
      provider_positions:
        issue.provider_positions.map(
          (position) => ({
            provider:
              position.provider,
            model:
              position.model,
            position:
              position.position,
          })
        ),
    })
  );

  const system = [
    "You are the FINAL STRUCTURAL AUDITOR for a professional multi-model tax engine.",
    "",
    "You are NOT deciding which tax position is legally correct.",
    "You are ONLY determining structural relationships among propositions.",
    "",
    "Classify related ISSUE GROUPS using exactly one of:",
    "",
    "equivalent:",
    "- materially the same legal proposition expressed differently;",
    "- one statement may contain slightly more explanation but reaches the same legal conclusion.",
    "",
    "complementary:",
    "- different propositions that can both be true;",
    "- one may state methodology while another states the resulting calculation;",
    "- one may be a prerequisite and another a consequence;",
    "- DO NOT treat complementary propositions as disagreements.",
    "",
    "conflicting:",
    "- propositions answer the SAME legal/mechanical question with mutually incompatible results;",
    "- examples include taxable vs nontaxable, applies vs does not apply, Category 3 vs Category 4 for the same filing-status question, 37.5% vs 50% for the same rate question, or materially different dollar calculations for the same liability.",
    "",
    "distinct:",
    "- genuinely separate legal questions even if part of the same transaction;",
    "- for example entity status is distinct from information-reporting category; income computation is distinct from foreign tax credit mechanics.",
    "",
    "CRITICAL RULES:",
    "1. Different wording is NOT disagreement.",
    "2. Methodology and a numerical result from that methodology are generally complementary unless the methodology itself contradicts the result.",
    "3. Different legal subquestions must not be merged merely because they involve the same taxpayer, transaction, tax regime, or Code chapter.",
    "4. Mutually exclusive filing categories, rates, amounts, classifications, taxable/nontaxable results, availability/nonavailability, or applies/does-not-apply results for the SAME question are conflicting.",
    "5. Do not choose the legally correct answer.",
    "",
    "Return STRICT JSON ONLY:",
    "{",
    '  "relations": [',
    "    {",
    '      "issue_ids": string[],',
    '      "relation": "equivalent" | "complementary" | "conflicting" | "distinct",',
    '      "reasoning": string',
    "    }",
    "  ]",
    "}",
  ].join("\n");

  const user = [
    args.input.jurisdiction
      ? `Jurisdiction: ${args.input.jurisdiction}`
      : "",
    `Question:\n${args.input.question}`,
    args.input.facts
      ? `Facts:\n${args.input.facts}`
      : "",
    "",
    "CURRENT ISSUE LEDGER:",
    JSON.stringify(
      compact,
      null,
      2
    ),
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const response =
      await client.chat.completions.create({
        model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: system,
          },
          {
            role: "user",
            content: user,
          },
        ],
        max_tokens: 3200,
      });

    const raw =
      response.choices?.[0]
        ?.message?.content || "{}";

    const parsed =
      safeJsonParse<LedgerStructuralAuditJson>(
        extractJsonObject(raw)
      );

    if (
      !parsed?.relations ||
      !Array.isArray(parsed.relations)
    ) {
      return null;
    }

    const validIds =
      new Set(
        args.issues.map(
          (issue) => issue.issue_id
        )
      );

    const relations =
      parsed.relations
        .map((relation) => ({
          issue_ids: uniq(
            Array.isArray(
              relation.issue_ids
            )
              ? relation.issue_ids
                  .map((x) =>
                    String(x || "").trim()
                  )
                  .filter(
                    (x) =>
                      validIds.has(x)
                  )
              : []
          ),
          relation:
            normalizeStructuralRelation(
              relation.relation
            ),
          reasoning:
            String(
              relation.reasoning || ""
            ).trim(),
        }))
        .filter(
          (relation) =>
            relation.issue_ids.length >= 2
        );

    return { relations };
  } catch {
    return null;
  }
}

function mergeStructurallyEquivalentIssues(
  members: IssueResolution[],
  reasoning: string
): IssueResolution {
  const merged =
    mergeDuplicateIssueResolutions(
      members
    )[0] || members[0];

  const collapsedPositions =
    collapseEquivalentProviderPositions(
      members.flatMap(
        (issue) =>
          issue.provider_positions
      )
    );

  const blockers =
    members.some(
      (issue) =>
        issue.status === "unresolved" ||
        issue.status === "fact_dependent" ||
        issue.status === "rejected"
    );

  const hasRealConflict =
    collapsedPositions.some(
      (a, index) =>
        collapsedPositions
          .slice(index + 1)
          .some(
            (b) =>
              !positionsMateriallyEquivalent(
                a.position,
                b.position
              )
          )
    );

  if (
    blockers &&
    hasRealConflict
  ) {
    return {
      ...merged,
      provider_positions:
        collapsedPositions,
      status: "unresolved",
      resolved_position: undefined,
      disagreements: uniq(
        collapsedPositions.map(
          (x) => x.position
        )
      ),
      reasoning:
        `${merged.reasoning} | Structural audit: ${reasoning}`,
      confidence: "low",
    };
  }

  const representative =
    collapsedPositions[0]
      ?.position ||
    members.find(
      (x) => x.resolved_position
    )?.resolved_position ||
    merged.issue_statement;

  return {
    ...merged,
    provider_positions:
      collapsedPositions,
    status:
      members.every(
        (x) =>
          x.status === "verified"
      )
        ? "verified"
        : "supported",
    resolved_position:
      representative,
    disagreements: [],
    reasoning:
      `${merged.reasoning} | Phase 4.1 structural audit merged semantically equivalent propositions. ${reasoning}`,
    confidence:
      members.every(
        (x) =>
          x.status === "verified"
      )
        ? "high"
        : "medium",
  };
}

function mergeStructurallyConflictingIssues(
  members: IssueResolution[],
  reasoning: string
): IssueResolution {
  const base = members[0];

  const positions =
    collapseEquivalentProviderPositions(
      members.flatMap(
        (issue) =>
          issue.provider_positions
      )
    );

  return {
    ...base,
    issue_label:
      members
        .map((x) => x.issue_label)
        .sort(
          (a, b) =>
            a.length - b.length
        )[0] ||
      base.issue_label,
    provider_positions:
      positions,
    status: "unresolved",
    resolved_position: undefined,
    controlling:
      members.some(
        (x) => x.controlling
      ),
    missing_facts: uniq(
      members.flatMap(
        (x) => x.missing_facts
      )
    ),
    disagreements: uniq(
      positions.map(
        (x) => x.position
      )
    ),
    rejected_positions: uniq(
      members.flatMap(
        (x) =>
          x.rejected_positions
      )
    ),
    reasoning:
      `${uniq(
        members.map(
          (x) => x.reasoning
        )
      ).join(" | ")} | Phase 4.1 structural audit identified mutually incompatible answers to the same controlling question. ${reasoning}`,
    confidence: "low",
  };
}

function applyStructuralAudit(
  issues: IssueResolution[],
  audit: LedgerStructuralAuditJson | null
): IssueResolution[] {
  if (
    !audit?.relations?.length
  ) {
    return enforceInternalIssueConsistency(
      issues
    );
  }

  let working =
    enforceInternalIssueConsistency(
      issues
    );

  const consumed =
    new Set<string>();

  const replacements:
    IssueResolution[] = [];

  // Conflicts have highest precedence.
  for (
    const relation of audit.relations
  ) {
    if (
      relation.relation !==
        "conflicting"
    ) {
      continue;
    }

    const members =
      working.filter(
        (issue) =>
          relation.issue_ids?.includes(
            issue.issue_id
          )
      );

    if (members.length < 2) {
      continue;
    }

    members.forEach(
      (x) =>
        consumed.add(x.issue_id)
    );

    replacements.push(
      mergeStructurallyConflictingIssues(
        members,
        relation.reasoning || ""
      )
    );
  }

  // Equivalent propositions merge only if none were consumed by a conflict.
  for (
    const relation of audit.relations
  ) {
    if (
      relation.relation !==
        "equivalent"
    ) {
      continue;
    }

    const members =
      working.filter(
        (issue) =>
          !consumed.has(
            issue.issue_id
          ) &&
          relation.issue_ids?.includes(
            issue.issue_id
          )
      );

    if (members.length < 2) {
      continue;
    }

    members.forEach(
      (x) =>
        consumed.add(x.issue_id)
    );

    replacements.push(
      mergeStructurallyEquivalentIssues(
        members,
        relation.reasoning || ""
      )
    );
  }

  // Complementary and distinct issues intentionally stay separate.
  const untouched =
    working.filter(
      (issue) =>
        !consumed.has(
          issue.issue_id
        )
    );

  return enforceInternalIssueConsistency([
    ...untouched,
    ...replacements,
  ]);
}

function deterministicLedgerRelation(
  a: IssueResolution,
  b: IssueResolution
): LedgerRelation {
  if (a.issue_id === b.issue_id) {
    return "same_issue_aligned";
  }

  const ai = issueResolutionIdentity(a);
  const bi = issueResolutionIdentity(b);

  const tokensA =
    issueResolutionSemanticTokens(a);
  const tokensB =
    issueResolutionSemanticTokens(b);

  const overlap = tokenOverlapRatio(
    tokensA,
    tokensB
  );

  const jaccard = tokenJaccard(
    tokensA,
    tokensB
  );

  const sharedAnchor = shareIssueAnchor(
    ai.legalAnchors,
    bi.legalAnchors
  );

  const sharedNumbers =
    sharedMaterialNumbers(a, b);

  const opposing =
    hasOpposingLegalSignals(a, b);

  // Strongly same controlling question.
  const sameQuestion =
    (
      sharedAnchor &&
      overlap >= 0.40 &&
      jaccard >= 0.18
    ) ||
    (
      overlap >= 0.78 &&
      jaccard >= 0.44
    ) ||
    (
      sharedNumbers > 0 &&
      overlap >= 0.58 &&
      jaccard >= 0.30
    );

  if (sameQuestion && opposing) {
    return "same_issue_conflicting";
  }

  if (sameQuestion) {
    return "same_issue_aligned";
  }

  // Parent-child relation: high containment but lower symmetric similarity.
  if (
    overlap >= 0.72 &&
    jaccard >= 0.26
  ) {
    return "parent_child";
  }

  return "unrelated";
}

function normalizeLedgerRelation(
  value: unknown
): LedgerRelation {
  const v = String(value || "")
    .trim()
    .toLowerCase();

  if (
    v === "same_issue_conflicting" ||
    v === "parent_child" ||
    v === "same_issue_aligned"
  ) {
    return v;
  }

  return "unrelated";
}

async function classifyLedgerRelationsWithOpenAI(args: {
  input: CrosscheckInput;
  issues: IssueResolution[];
}): Promise<Map<string, LedgerRelation> | null> {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey || args.issues.length < 2) {
    return null;
  }

  const model =
    env("OPENAI_LEDGER_RELATION_MODEL") ||
    env("OPENAI_ISSUE_CLUSTER_MODEL") ||
    env("OPENAI_ISSUE_ADJUDICATOR_MODEL") ||
    env("OPENAI_MODEL") ||
    "gpt-4.1-mini";

  const client = new OpenAI({ apiKey });

  const compactIssues = args.issues.map(
    (issue) => ({
      issue_id: issue.issue_id,
      issue_label: issue.issue_label,
      issue_statement: issue.issue_statement,
      status: issue.status,
      resolved_position:
        issue.resolved_position || null,
      provider_positions:
        issue.provider_positions.map(
          (position) => position.position
        ),
      disagreements:
        issue.disagreements,
    })
  );

  const system = [
    "You are a ledger-integrity classifier inside a professional tax analysis engine.",
    "You are NOT deciding tax law.",
    "You are NOT choosing the correct provider.",
    "",
    "Classify whether pairs of ledger issues represent:",
    "- same_issue_aligned: same controlling legal/mechanical question with materially compatible positions;",
    "- same_issue_conflicting: same controlling question but materially incompatible outcomes;",
    "- parent_child: one is a narrower component of the other's controlling question;",
    "- unrelated: genuinely distinct issues.",
    "",
    "Important:",
    "Do not treat different wording as different issues merely because providers used different labels.",
    "Taxable vs nontaxable, applies vs does-not-apply, filing category A vs filing category B, different rates, different numerical liabilities, or mutually exclusive characterizations of the same transaction are SAME ISSUE CONFLICTS.",
    "Do not merge merely because two issues involve the same taxpayer.",
    "",
    "Return STRICT JSON ONLY:",
    "{",
    '  "relations": [',
    "    {",
    '      "issue_a": string,',
    '      "issue_b": string,',
    '      "relation": "same_issue_aligned" | "same_issue_conflicting" | "parent_child" | "unrelated",',
    '      "reasoning": string',
    "    }",
    "  ]",
    "}",
  ].join("\n");

  const user = [
    args.input.jurisdiction
      ? `Jurisdiction: ${args.input.jurisdiction}`
      : "",
    `Question:\n${args.input.question}`,
    args.input.facts
      ? `Facts:\n${args.input.facts}`
      : "",
    "",
    "LEDGER ISSUES:",
    JSON.stringify(compactIssues, null, 2),
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const response =
      await client.chat.completions.create({
        model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: system,
          },
          {
            role: "user",
            content: user,
          },
        ],
        max_tokens: 2600,
      });

    const raw =
      response.choices?.[0]?.message
        ?.content || "{}";

    const parsed =
      safeJsonParse<LedgerRelationJson>(
        extractJsonObject(raw)
      );

    if (
      !parsed?.relations ||
      !Array.isArray(parsed.relations)
    ) {
      return null;
    }

    const validIds = new Set(
      args.issues.map(
        (issue) => issue.issue_id
      )
    );

    const relations =
      new Map<string, LedgerRelation>();

    for (const relation of parsed.relations) {
      const a = String(
        relation.issue_a || ""
      ).trim();

      const b = String(
        relation.issue_b || ""
      ).trim();

      if (
        !validIds.has(a) ||
        !validIds.has(b) ||
        a === b
      ) {
        continue;
      }

      const key =
        [a, b].sort().join("::");

      relations.set(
        key,
        normalizeLedgerRelation(
          relation.relation
        )
      );
    }

    return relations;
  } catch {
    return null;
  }
}

function relationKey(
  a: IssueResolution,
  b: IssueResolution
): string {
  return [a.issue_id, b.issue_id]
    .sort()
    .join("::");
}

function mergeIssueFamily(
  members: IssueResolution[],
  forceConflict: boolean
): IssueResolution {
  const base = members[0];

  const providerPositions = Array.from(
    new Map(
      members
        .flatMap(
          (issue) =>
            issue.provider_positions
        )
        .map((position) => [
          [
            position.provider,
            position.model,
            normalizeIssueIdentityText(
              position.position
            ),
          ].join("::"),
          position,
        ])
    ).values()
  );

  const statuses = members.map(
    (issue) => issue.status
  );

  const resolvedPositions = uniq(
    members
      .map(
        (issue) =>
          issue.resolved_position || ""
      )
      .filter(Boolean)
  );

  let status: ResolutionStatus;

  if (
    forceConflict ||
    statuses.includes("unresolved") ||
    resolvedPositions.length > 1
  ) {
    status = "unresolved";
  } else if (
    statuses.includes("fact_dependent")
  ) {
    status = "fact_dependent";
  } else if (
    statuses.every(
      (status) => status === "verified"
    )
  ) {
    status = "verified";
  } else if (
    statuses.every(
      (status) => status === "rejected"
    )
  ) {
    status = "rejected";
  } else {
    status = "supported";
  }

  const authorityValidations = members
    .map(
      (issue) =>
        issue.authority_validation
    )
    .filter(Boolean);

  const authorityValidation =
    authorityValidations.find(
      (validation) =>
        validation?.verdict ===
        "contradicted"
    ) ||
    authorityValidations.find(
      (validation) =>
        validation?.verdict ===
        "insufficient"
    ) ||
    authorityValidations[0];

  return {
    ...base,
    issue_label:
      canonicalIssueLabel(
        members.map((issue) => ({
          claim_id: issue.issue_id,
          provider: "",
          model: "",
          statement:
            issue.issue_statement,
          topic: issue.issue_label,
          confidence:
            issue.confidence,
          applies_to: [],
        }))
      ),
    provider_positions:
      providerPositions,
    status,
    resolved_position:
      status === "verified" &&
      resolvedPositions.length === 1
        ? resolvedPositions[0]
        : status === "supported" &&
          resolvedPositions.length === 1
        ? resolvedPositions[0]
        : undefined,
    reasoning:
      uniq(
        members
          .map(
            (issue) => issue.reasoning
          )
          .filter(Boolean)
      ).join(" | ") +
      " | Phase 3I-Z ledger-family integrity merged related controlling issues before final synthesis.",
    controlling:
      members.some(
        (issue) => issue.controlling
      ),
    missing_facts: uniq(
      members.flatMap(
        (issue) => issue.missing_facts
      )
    ),
    disagreements: uniq([
      ...members.flatMap(
        (issue) => issue.disagreements
      ),
      ...(status === "unresolved"
        ? providerPositions.map(
            (position) =>
              position.position
          )
        : []),
    ]),
    rejected_positions: uniq(
      members.flatMap(
        (issue) =>
          issue.rejected_positions
      )
    ),
    confidence:
      status === "verified"
        ? "high"
        : status === "supported"
        ? "medium"
        : "low",
    ...(authorityValidation
      ? {
          authority_validation:
            authorityValidation,
        }
      : {}),
  };
}

function assertLedgerInvariants(
  issues: IssueResolution[]
): {
  ok: boolean;
  violations: string[];
} {
  const violations: string[] = [];

  const ids = new Set<string>();

  for (const issue of issues) {
    if (ids.has(issue.issue_id)) {
      violations.push(
        `duplicate issue_id: ${issue.issue_id}`
      );
    }

    ids.add(issue.issue_id);

    if (
      issue.status === "unresolved" &&
      issue.resolved_position
    ) {
      violations.push(
        `unresolved issue has resolved_position: ${issue.issue_id}`
      );
    }

    if (
      issue.status === "rejected" &&
      issue.resolved_position
    ) {
      violations.push(
        `rejected issue has resolved_position: ${issue.issue_id}`
      );
    }

    if (
      issue.status === "verified" &&
      issue.authority_validation &&
      issue.authority_validation.verdict !==
        "verified"
    ) {
      violations.push(
        `verified issue lacks verified authority status: ${issue.issue_id}`
      );
    }
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}

function failClosedLedgerOnInvariantViolation(
  issues: IssueResolution[],
  violations: string[]
): IssueResolution[] {
  if (!violations.length) return issues;

  return issues.map((issue) => {
    if (!issue.controlling) {
      return issue;
    }

    if (issue.status === "verified") {
      return issue;
    }

    return {
      ...issue,
      status: "unresolved",
      resolved_position: undefined,
      reasoning:
        `${issue.reasoning} | Final ledger invariant check detected an integrity violation elsewhere in the controlling ledger. This issue is not allowed to become reliance-ready until ledger integrity is restored.`,
      disagreements: uniq([
        ...issue.disagreements,
        ...violations,
      ]),
      confidence: "low",
    };
  });
}

async function enforceNuclearLedgerIntegrity(args: {
  input: CrosscheckInput;
  issues: IssueResolution[];
}): Promise<IssueResolution[]> {
  if (!args.issues.length) return [];

  let issues =
    enforceCanonicalLedgerIntegrity(
      args.issues
    );

  // Phase 4:
  // First repair issue granularity and collapse wording-only differences.
  // This prevents an entire legal family from being treated as one issue,
  // while also preventing equivalent statements from becoming fake conflicts.
  issues =
    normalizeLedgerIssueGranularity(
      issues
    );

  const aiRelations =
    await classifyLedgerRelationsWithOpenAI({
      input: args.input,
      issues,
    }).catch(() => null);

  const parent = issues.map(
    (_, index) => index
  );

  const familyConflict =
    new Map<number, boolean>();

  const find = (index: number): number => {
    let current = index;

    while (
      parent[current] !== current
    ) {
      parent[current] =
        parent[parent[current]];

      current = parent[current];
    }

    return current;
  };

  const union = (
    a: number,
    b: number,
    conflict: boolean
  ): void => {
    const ra = find(a);
    const rb = find(b);

    if (ra === rb) {
      if (conflict) {
        familyConflict.set(
          ra,
          true
        );
      }
      return;
    }

    parent[rb] = ra;

    familyConflict.set(
      ra,
      Boolean(
        conflict ||
        familyConflict.get(ra) ||
        familyConflict.get(rb)
      )
    );
  };

  for (
    let i = 0;
    i < issues.length;
    i++
  ) {
    for (
      let j = i + 1;
      j < issues.length;
      j++
    ) {
      const deterministic =
        deterministicLedgerRelation(
          issues[i],
          issues[j]
        );

      const ai =
        aiRelations?.get(
          relationKey(
            issues[i],
            issues[j]
          )
        );

      // Conservative relation precedence.
      const relation: LedgerRelation =
        ai ===
          "same_issue_conflicting" ||
        deterministic ===
          "same_issue_conflicting"
          ? "same_issue_conflicting"
          : ai ===
              "same_issue_aligned" ||
            deterministic ===
              "same_issue_aligned"
          ? "same_issue_aligned"
          : ai === "parent_child" ||
            deterministic ===
              "parent_child"
          ? "parent_child"
          : "unrelated";

      if (
        relation ===
          "same_issue_conflicting"
      ) {
        union(i, j, true);
      } else if (
        relation ===
          "same_issue_aligned"
      ) {
        union(i, j, false);
      }
    }
  }

  const families =
    new Map<
      number,
      IssueResolution[]
    >();

  issues.forEach(
    (issue, index) => {
      const root = find(index);

      const bucket =
        families.get(root) || [];

      bucket.push(issue);
      families.set(root, bucket);
    }
  );

  issues = Array.from(
    families.entries()
  ).map(([root, members]) =>
    mergeIssueFamily(
      members,
      Boolean(
        familyConflict.get(
          find(root)
        )
      )
    )
  );

  // Apply parent-child blocking again after family merging.
  issues =
    protectBlockingParentIssues(
      issues
    );

  issues =
    mergeDuplicateIssueResolutions(
      issues
    );

  issues =
    normalizeLedgerIssueGranularity(
      issues
    );

  // Phase 4.1 — final proposition-aware structural audit.
  //
  // This is deliberately the last semantic operation on the ledger.
  // It distinguishes equivalence, complementarity, true conflict,
  // and distinct legal subquestions across the entire ledger.
  const structuralAudit =
    await auditLedgerStructureWithOpenAI({
      input: args.input,
      issues,
    }).catch(() => null);

  issues =
    applyStructuralAudit(
      issues,
      structuralAudit
    );

  // One final deterministic consistency check after the global audit.
  issues =
    enforceInternalIssueConsistency(
      issues
    );

  const invariant =
    assertLedgerInvariants(
      issues
    );

  if (!invariant.ok) {
    issues =
      failClosedLedgerOnInvariantViolation(
        issues,
        invariant.violations
      );
  }

  return issues;
}

function enforceCanonicalLedgerIntegrity(
  issues: IssueResolution[]
): IssueResolution[] {
  if (!issues.length) return [];

  const deduplicated =
    mergeDuplicateIssueResolutions(issues);

  const parentProtected =
    protectBlockingParentIssues(deduplicated);

  // Parent protection can make two previously different entries
  // canonical duplicates. Merge one final time.
  return mergeDuplicateIssueResolutions(
    parentProtected
  );
}

async function consolidateControllingProviderClaims(args: {
  input: CrosscheckInput;
  artifacts: ProviderMemoArtifact[];
}): Promise<IssueResolution[]> {
  const claims = collectControllingClaimCandidates(args.artifacts);
  if (!claims.length) return [];

  const claimsById = new Map(
    claims.map((claim) => [claim.claim_id, claim])
  );

  const apiKey = env("OPENAI_API_KEY");

  let groups: SemanticClaimGroup[] | null = null;

  if (apiKey) {
    const model =
      env("OPENAI_ISSUE_CLUSTER_MODEL") ||
      env("OPENAI_ISSUE_ADJUDICATOR_MODEL") ||
      env("OPENAI_ADJUDICATOR_MODEL") ||
      env("OPENAI_MODEL") ||
      "gpt-4.1-mini";

    const client = new OpenAI({ apiKey });

    const system = [
      "You are a semantic issue-clustering stage inside a tax crosscheck engine.",
      "You are NOT deciding which provider is correct.",
      "You are NOT writing a tax memo.",
      "",
      "Your sole job is to group controlling provider claims that answer the SAME underlying legal, computational, filing, classification, rate, timing, or mechanical issue.",
      "",
      "Examples of claims that belong in the SAME issue:",
      "- competing numeric calculations of the same tax inclusion or liability;",
      "- different Form filing categories for the same filing obligation;",
      "- different rates or thresholds for the same rule;",
      "- competing characterizations of the same transaction;",
      "- one provider saying a rule applies and another saying it does not.",
      "",
      "Do NOT combine claims merely because they share a broad tax topic.",
      "For example, GILTI inclusion amount, Section 250 deduction, FTC limitation, and QBAI mechanics are separate issues unless the individual claims actually answer the same question.",
      "",
      "CRITICAL SAFETY RULES:",
      "1. Use only the supplied claim IDs.",
      "2. Do not invent provider positions.",
      "3. Every claim ID must appear in exactly one group.",
      "4. Preserve competing positions inside one group rather than splitting them into separate groups.",
      "5. relationship='aligned' only if the claims are materially consistent.",
      "6. relationship='conflicting' if the claims reach incompatible outcomes.",
      "7. relationship='mixed' if they overlap but contain a material unresolved distinction.",
      "8. Differences in numerical amount, filing category, legal applicability, rate, threshold, direction, or tax character are material unless plainly reconcilable.",
      "",
      "Return STRICT JSON ONLY:",
      "{",
      '  "groups": [',
      "    {",
      '      "issue_label": string,',
      '      "issue_statement": string,',
      '      "claim_ids": string[],',
      '      "relationship": "aligned" | "conflicting" | "mixed",',
      '      "reasoning": string',
      "    }",
      "  ]",
      "}",
    ].join("\n");

    const user = [
      args.input.jurisdiction
        ? `Jurisdiction: ${args.input.jurisdiction}`
        : "",
      args.input.facts
        ? `Facts:\n${args.input.facts}`
        : "",
      `Question:\n${args.input.question}`,
      "",
      "CONTROLLING PROVIDER CLAIMS:",
      JSON.stringify(claims, null, 2),
    ]
      .filter(Boolean)
      .join("\n\n");

    try {
      const response = await client.chat.completions.create({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 2200,
      });

      const raw =
        response.choices?.[0]?.message?.content || "{}";

      const parsed =
        safeJsonParse<SemanticClaimGroupingJson>(
          extractJsonObject(raw)
        );

      if (parsed?.groups && Array.isArray(parsed.groups)) {
        const used = new Set<string>();
        const candidateGroups: SemanticClaimGroup[] = [];

        for (const rawGroup of parsed.groups) {
          const claimIds = Array.isArray(rawGroup.claim_ids)
            ? uniq(
                rawGroup.claim_ids
                  .map((x) => String(x || "").trim())
                  .filter(
                    (id) =>
                      claimsById.has(id) &&
                      !used.has(id)
                  )
              )
            : [];

          if (!claimIds.length) continue;

          claimIds.forEach((id) => used.add(id));

          const relationRaw = String(
            rawGroup.relationship || ""
          )
            .trim()
            .toLowerCase();

          const relationship:
            | "aligned"
            | "conflicting"
            | "mixed" =
            relationRaw === "conflicting" ||
            relationRaw === "mixed"
              ? relationRaw
              : "aligned";

          candidateGroups.push({
            issue_label:
              String(rawGroup.issue_label || "").trim(),
            issue_statement:
              String(
                rawGroup.issue_statement || ""
              ).trim(),
            claim_ids: claimIds,
            relationship,
            reasoning:
              String(rawGroup.reasoning || "").trim(),
          });
        }

        // Never lose a controlling claim because of clustering output.
        for (const claim of claims) {
          if (used.has(claim.claim_id)) continue;

          candidateGroups.push({
            issue_label:
              claim.topic ||
              claim.applies_to[0] ||
              claim.statement,
            issue_statement:
              claim.topic ||
              claim.applies_to[0] ||
              claim.statement,
            claim_ids: [claim.claim_id],
            relationship: "aligned",
            reasoning:
              "Controlling claim was not assigned by the semantic clustering response and was preserved as a singleton issue.",
          });
        }

        groups = candidateGroups;
      }
    } catch {
      groups = null;
    }
  }

  if (!groups?.length) {
    groups = fallbackSemanticGroups(claims);
  }

  return groups
    .map((group, index) =>
      buildConsolidatedIssueFromGroup({
        group,
        claimsById,
        index,
      })
    )
    .filter(Boolean) as IssueResolution[];
}

function buildInitialIssueResolutionLedger(
  matrix: ConflictMatrix
): IssueResolution[] {
  const ledger: IssueResolution[] = [];

  matrix.common_claims.forEach((claim, index) => {
    const statement = String(claim || "").trim();
    if (!statement) return;

    ledger.push({
      issue_id: issueId("common", statement, index),
      issue_label: statement,
      issue_statement: statement,
      provider_positions: [],
      status: "supported",
      resolved_position: statement,
      reasoning:
        "Multiple provider analyses converged on this proposition and the conflict matrix did not identify a material dispute. Independent validation may still upgrade or downgrade this status.",
      controlling: false,
      missing_facts: [],
      disagreements: [],
      rejected_positions: [],
      confidence: "medium",
    });
  });

  matrix.disputed_claims.forEach((claim, index) => {
    const statement = String(claim.claim_statement || "").trim();
    if (!statement) return;

    ledger.push({
      issue_id:
        String(claim.claim_id || "").trim() ||
        issueId("disputed", statement, index),
      issue_label: statement,
      issue_statement: statement,
      provider_positions: claim.provider_positions.map((position) => ({
        provider: position.provider,
        model: position.model,
        position: position.position,
        confidence: position.confidence,
      })),
      status: "unresolved",
      reasoning:
        String(claim.why_controlling || "").trim() ||
        "The providers materially disagree on this proposition. Model convergence is relevant evidence, but the issue should be resolved by weighing convergence together with factual fit, legal or mechanical reasoning, and whether any minority position identifies a controlling distinction. If one position is materially stronger, it may be selected as the best-supported crosscheck position; otherwise keep the issue unresolved.",
      controlling: true,
      missing_facts: [],
      disagreements: claim.provider_positions
        .map((position) => position.position)
        .filter(Boolean),
      rejected_positions: [],
      confidence: "low",
    });
  });

  matrix.missing_or_underdeveloped_issues.forEach((issue, index) => {
    const statement = String(issue || "").trim();
    if (!statement) return;

    ledger.push({
      issue_id: issueId("missing", statement, index),
      issue_label: statement,
      issue_statement: statement,
      provider_positions: [],
      status: "fact_dependent",
      reasoning:
        "The cross-model review identified this issue as missing or insufficiently developed. The final treatment depends on additional facts or analysis.",
      controlling: true,
      missing_facts: [statement],
      disagreements: [],
      rejected_positions: [],
      confidence: "low",
    });
  });

  return ledger;
}

function normalizeIssueResolutionLedger(
  raw: unknown,
  fallback: IssueResolution[]
): IssueResolution[] {
  if (!Array.isArray(raw)) return fallback;

  const fallbackById = new Map(
    fallback.map((issue) => [issue.issue_id, issue])
  );

  const allowedStatuses = new Set([
    "supported",
    "fact_dependent",
    "unresolved",
    "rejected",
  ]);

  const allowedConfidence = new Set(["low", "medium", "high"]);

  const normalized: IssueResolution[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;

    const obj = item as Record<string, unknown>;
    const issueIdValue = String(obj.issue_id || "").trim();

    if (!issueIdValue) continue;

    const prior = fallbackById.get(issueIdValue);
    if (!prior) continue;

    const rawStatus = String(obj.status || "").trim().toLowerCase();

    // IMPORTANT:
    // This adjudication stage does not have an independent authoritative
    // source layer. It is therefore not allowed to upgrade anything to
    // "verified". Verification is reserved for a later authority-validation pass.
    const status =
      allowedStatuses.has(rawStatus)
        ? (rawStatus as IssueResolution["status"])
        : prior.status === "verified"
        ? "supported"
        : prior.status;

    const rawConfidence = String(obj.confidence || "")
      .trim()
      .toLowerCase();

    const confidence =
      allowedConfidence.has(rawConfidence)
        ? (rawConfidence as IssueResolution["confidence"])
        : prior.confidence;

    const asStrings = (value: unknown): string[] =>
      Array.isArray(value)
        ? uniq(value.map((x) => String(x || "").trim()).filter(Boolean))
        : [];

    normalized.push({
      ...prior,
      issue_label:
        String(obj.issue_label || "").trim() || prior.issue_label,
      issue_statement:
        String(obj.issue_statement || "").trim() || prior.issue_statement,
      status,
      resolved_position:
        String(obj.resolved_position || "").trim() ||
        prior.resolved_position,
      reasoning:
        String(obj.reasoning || "").trim() || prior.reasoning,
      controlling:
        typeof obj.controlling === "boolean"
          ? obj.controlling
          : prior.controlling,
      missing_facts: asStrings(obj.missing_facts).length
        ? asStrings(obj.missing_facts)
        : prior.missing_facts,
      disagreements: asStrings(obj.disagreements).length
        ? asStrings(obj.disagreements)
        : prior.disagreements,
      rejected_positions: asStrings(obj.rejected_positions),
      confidence,
    });
  }

  const normalizedById = new Map(
    normalized.map((issue) => [issue.issue_id, issue])
  );

  // Preserve every original issue even if the adjudicator omitted one.
  return fallback.map(
    (issue) => normalizedById.get(issue.issue_id) || issue
  );
}

async function adjudicateIssueResolutionLedgerWithOpenAI(args: {
  input: CrosscheckInput;
  initialLedger: IssueResolution[];
  artifacts: ProviderMemoArtifact[];
  assessments: ProviderAssessment[];
  conflictMatrix: ConflictMatrix;
}): Promise<IssueResolution[]> {
  if (!args.initialLedger.length) return [];

  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) return args.initialLedger;

  const model =
    env("OPENAI_ISSUE_ADJUDICATOR_MODEL") ||
    env("OPENAI_ADJUDICATOR_MODEL") ||
    env("OPENAI_SYNTH_MODEL") ||
    env("OPENAI_MODEL") ||
    "gpt-4.1-mini";

  const client = new OpenAI({ apiKey });

  const system = [
    "You are an issue-level tax adjudicator inside a multi-model tax analysis engine.",
    "You are NOT writing the final memo.",
    "You must adjudicate each issue independently.",
    "",
    "CORE PRINCIPLES",
    "1. Model agreement is evidence of convergence, not proof of correctness.",
    "2. Do not resolve an issue by simple majority alone. Treat independent model convergence as material evidence and weigh it together with factual fit, legal or mechanical reasoning, internal consistency, and whether a minority position identifies a genuinely controlling distinction. When one position is materially stronger on the available record, select it as the best-supported crosscheck position even if independent authority verification has not occurred.",
    "3. A minority position may be controlling if it identifies a legally or mechanically important distinction.",
    "4. Do not reward fluency, length, confidence, or repetition.",
    "5. Separate factual ambiguity from legal disagreement.",
    "6. Preserve branch outcomes where different facts produce different results.",
    "7. If the supplied facts are insufficient, mark the issue fact_dependent.",
    "8. If competing positions cannot be safely resolved from the available material, mark the issue unresolved.",
    "9. You may reject a provider position only when the available material demonstrates that it is internally inconsistent, mechanically incompatible with the stated facts, contradicted by controlling source material supplied in the input, or otherwise unsupportable from the record.",
    "10. Do not invent statutes, regulations, treaties, authorities, rates, dates, or citations.",
    "",
    "STATUS RULES",
    '- "supported": best available position is materially stronger and no controlling conflict remains, but it has NOT been independently authority-verified.',
    '- "fact_dependent": resolution turns on one or more missing facts; identify them explicitly.',
    '- "unresolved": available reasoning does not safely resolve competing legal or mechanical positions.',
    '- "rejected": the issue proposition itself or identified position is unsupportable from the supplied record.',
    "",
    'You MUST NOT return status "verified". Independent authority verification occurs in a later pipeline stage.',
    "",
    "For numeric disputes, identify the precise assumption, formula component, classification, or input causing the difference rather than averaging the numbers.",
    "For scope or classification disputes, identify the controlling factual or legal branch.",
    "For compliance disputes, distinguish filing requirement, filing category, form mechanics, and substantive tax treatment rather than blending them.",
    "",
    "Return STRICT JSON ONLY as an array of issue objects with these keys:",
    "issue_id, issue_label, issue_statement, status, resolved_position, reasoning, controlling, missing_facts, disagreements, rejected_positions, confidence.",
  ].join("\\n");

  const user = [
    args.input.jurisdiction
      ? `Jurisdiction: ${args.input.jurisdiction}`
      : "",
    args.input.facts
      ? `Facts:\\n${args.input.facts}`
      : "",
    args.input.constraints
      ? `Constraints:\\n${args.input.constraints}`
      : "",
    `Question:\\n${args.input.question}`,
    "",
    responseLanguageInstruction(args.input),
    "",
    "INITIAL ISSUE LEDGER:",
    JSON.stringify(args.initialLedger, null, 2),
    "",
    "CONFLICT MATRIX:",
    serializeConflictMatrix(args.conflictMatrix),
    "",
    "PROVIDER ASSESSMENTS:",
    serializeAssessments(args.assessments),
    "",
    "PROVIDER ARTIFACTS:",
    serializeProviderArtifacts(args.artifacts),
  ]
    .filter(Boolean)
    .join("\\n\\n");

  const resp = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: clampInt(args.input.maxTokens, 1200, 4200, 2600),
  });

  const raw = resp.choices?.[0]?.message?.content || "[]";

  let parsed: unknown = null;

  try {
    parsed = JSON.parse(raw);
  } catch {
    const first = raw.indexOf("[");
    const last = raw.lastIndexOf("]");

    if (first >= 0 && last > first) {
      try {
        parsed = JSON.parse(raw.slice(first, last + 1));
      } catch {
        parsed = null;
      }
    }
  }

  return normalizeIssueResolutionLedger(
    parsed,
    args.initialLedger
  );
}

type AuthorityVerificationJson = {
  verdict?: "verified" | "contradicted" | "fact_dependent" | "insufficient" | string;
  reasoning?: string;
  missing_facts?: string[];
  rejected_positions?: string[];
  citations?: string[];
};

function authorityVerificationMaxIssues(): number {
  return clampInt(
    Number(env("CROSSCHECK_AUTHORITY_VERIFY_MAX")) || 6,
    1,
    12,
    6
  );
}

function authorityVerificationMinScore(): number {
  const raw = Number(env("CROSSCHECK_AUTHORITY_MIN_SCORE"));
  if (Number.isFinite(raw) && raw > 0 && raw < 1) return raw;
  return 0.58;
}

function authoritySourceIsPrimaryOrOfficial(sourceType: string | null): boolean {
  const normalized = String(sourceType || "").trim().toLowerCase();

  return (
    normalized === "statute" ||
    normalized === "regulation" ||
    normalized === "administrativeguidance" ||
    normalized === "caselaw" ||
    normalized === "treaty"
  );
}

function authorityVerificationPriority(issue: IssueResolution): number {
  let score = 0;

  if (issue.controlling) score += 100;

  if (issue.status === "unresolved") score += 80;
  else if (issue.status === "fact_dependent") score += 70;
  else if (issue.status === "supported") score += 60;
  else if (issue.status === "rejected") score += 40;

  if (issue.provider_positions.length >= 2) score += 20;
  if (issue.disagreements.length) score += 20;

  return score;
}

function normalizeAuthorityVerdict(value: unknown):
  | "verified"
  | "contradicted"
  | "fact_dependent"
  | "insufficient" {
  const normalized = String(value || "").trim().toLowerCase();

  if (
    normalized === "verified" ||
    normalized === "contradicted" ||
    normalized === "fact_dependent" ||
    normalized === "insufficient"
  ) {
    return normalized;
  }

  return "insufficient";
}

async function verifySingleIssueWithAuthority(args: {
  input: CrosscheckInput;
  issue: IssueResolution;
}): Promise<IssueResolution> {
  const proposedPosition =
    String(args.issue.resolved_position || "").trim() ||
    args.issue.issue_statement;

  const retrievalQuery = [
    args.input.jurisdiction
      ? `Jurisdiction: ${args.input.jurisdiction}`
      : "",
    `Tax question: ${args.input.question}`,
    args.input.facts
      ? `Relevant facts: ${args.input.facts}`
      : "",
    `Issue requiring authoritative verification: ${args.issue.issue_statement}`,
    `Proposed position to test: ${proposedPosition}`,
  ]
    .filter(Boolean)
    .join("\n");

  let retrieval;

  try {
    retrieval = await retrieveAuthority({
      query: retrievalQuery,
      topK: 6,
      minScore: authorityVerificationMinScore(),
    });
  } catch (error) {
    return {
      ...args.issue,
      authority_validation: {
        verdict: "insufficient",
        reasoning:
          "Authoritative retrieval was unavailable for this issue. The issue was not upgraded to verified.",
        citations: [],
      },
    };
  }

  if (!retrieval.ok || !retrieval.sources.length) {
    return {
      ...args.issue,
      authority_validation: {
        verdict: "insufficient",
        reasoning:
          `No sufficiently relevant authoritative source material was retrieved (${retrieval.reason || "insufficient retrieval"}). The issue was not upgraded to verified.`,
        citations: [],
      },
    };
  }

  const authoritativeSources = retrieval.sources.filter((source) =>
    authoritySourceIsPrimaryOrOfficial(source.source_type)
  );

  if (!authoritativeSources.length) {
    return {
      ...args.issue,
      authority_validation: {
        verdict: "insufficient",
        reasoning:
          "Retrieved material did not include a statute, regulation, administrative guidance, case law, or treaty source. The issue was not upgraded to verified.",
        citations: [],
      },
    };
  }

  const apiKey = env("OPENAI_API_KEY");

  if (!apiKey) {
    return {
      ...args.issue,
      authority_validation: {
        verdict: "insufficient",
        reasoning:
          "Authoritative source material was retrieved, but no authority-validation model was available.",
        citations: authoritativeSources.map((source) => ({
          cite: source.cite,
          score: source.score,
          country: source.country,
          jurisdiction: source.jurisdiction,
          law_code: source.law_code,
          article: source.article,
          section: source.section,
          source_type: source.source_type,
          citation_label: source.citation_label,
          source_url: source.source_url,
          page_start: source.page_start,
          page_end: source.page_end,
        })),
      },
    };
  }

  const model =
    env("OPENAI_AUTHORITY_VALIDATOR_MODEL") ||
    env("OPENAI_CLAIM_VALIDATOR_MODEL") ||
    env("OPENAI_ADJUDICATOR_MODEL") ||
    env("OPENAI_MODEL") ||
    "gpt-4.1-mini";

  const client = new OpenAI({ apiKey });

  const system = [
    "You are an authority-grounded tax issue verifier.",
    "You are NOT deciding which AI model sounds better.",
    "You must use ONLY the authoritative source excerpts supplied below.",
    "",
    "Your task is to determine whether the proposed tax position is established by the retrieved authority.",
    "",
    "VERDICT RULES",
    '- "verified": the supplied authority materially establishes the proposed legal/mechanical position for the stated issue.',
    '- "contradicted": the supplied authority materially conflicts with the proposed position.',
    '- "fact_dependent": the governing rule is supported, but one or more unresolved facts prevent application of the rule to the taxpayer.',
    '- "insufficient": the retrieved excerpts do not adequately establish or contradict the proposition.',
    "",
    "STRICT RULES",
    "1. Model consensus is irrelevant.",
    "2. Do not use outside memory or unstated legal knowledge.",
    "3. Do not invent statutes, regulations, cases, treaties, forms, rates, dates, or citations.",
    "4. Do not treat a merely similar statute or different jurisdiction as controlling.",
    "5. Do not treat CommercialDataset material as sufficient primary authority.",
    "6. Similarity score alone does not prove legal support.",
    "7. If the source addresses the general rule but not the factual trigger, use fact_dependent.",
    "8. If the excerpts are ambiguous or incomplete, use insufficient.",
    "9. Return only citation IDs actually supplied in the source block.",
    "",
    "Return STRICT JSON ONLY with keys:",
    "verdict, reasoning, missing_facts, rejected_positions, citations.",
  ].join("\n");

  const user = [
    args.input.jurisdiction
      ? `Jurisdiction: ${args.input.jurisdiction}`
      : "",
    args.input.facts
      ? `Facts:\n${args.input.facts}`
      : "",
    `Question:\n${args.input.question}`,
    "",
    `Issue:\n${args.issue.issue_statement}`,
    "",
    `Proposed position:\n${proposedPosition}`,
    "",
    "AUTHORITATIVE SOURCE EXCERPTS:",
    formatAuthorityContext(authoritativeSources),
  ]
    .filter(Boolean)
    .join("\n\n");

  let parsed: AuthorityVerificationJson | null = null;

  try {
    const response = await client.chat.completions.create({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 1100,
    });

    const raw =
      response.choices?.[0]?.message?.content || "{}";

    parsed =
      safeJsonParse<AuthorityVerificationJson>(
        extractJsonObject(raw)
      );
  } catch {
    parsed = null;
  }

  if (!parsed) {
    return {
      ...args.issue,
      authority_validation: {
        verdict: "insufficient",
        reasoning:
          "Authoritative source material was retrieved, but the verification result could not be parsed safely.",
        citations: authoritativeSources.map((source) => ({
          cite: source.cite,
          score: source.score,
          country: source.country,
          jurisdiction: source.jurisdiction,
          law_code: source.law_code,
          article: source.article,
          section: source.section,
          source_type: source.source_type,
          citation_label: source.citation_label,
          source_url: source.source_url,
          page_start: source.page_start,
          page_end: source.page_end,
        })),
      },
    };
  }

  const verdict = normalizeAuthorityVerdict(parsed.verdict);

  const allowedCitationIds = new Set(
    authoritativeSources.map((source) => source.cite)
  );

  const requestedCitationIds = Array.isArray(parsed.citations)
    ? parsed.citations
        .map((x) => String(x || "").trim())
        .filter((x) => allowedCitationIds.has(x))
    : [];

  const citedSources =
    requestedCitationIds.length
      ? authoritativeSources.filter((source) =>
          requestedCitationIds.includes(source.cite)
        )
      : verdict === "verified" || verdict === "contradicted"
      ? []
      : authoritativeSources.slice(0, 3);

  // A proposition cannot be called verified or contradicted unless
  // the verifier points to at least one retrieved authority source.
  const safeVerdict =
    (verdict === "verified" || verdict === "contradicted") &&
    !citedSources.length
      ? "insufficient"
      : verdict;

  const authorityValidation = {
    verdict: safeVerdict,
    reasoning:
      String(parsed.reasoning || "").trim() ||
      "Authority verification completed.",
    citations: citedSources.map((source) => ({
      cite: source.cite,
      score: source.score,
      country: source.country,
      jurisdiction: source.jurisdiction,
      law_code: source.law_code,
      article: source.article,
      section: source.section,
      source_type: source.source_type,
      citation_label: source.citation_label,
      source_url: source.source_url,
      page_start: source.page_start,
      page_end: source.page_end,
    })),
  } as const;

  const missingFacts = Array.isArray(parsed.missing_facts)
    ? uniq([
        ...args.issue.missing_facts,
        ...parsed.missing_facts.map((x) =>
          String(x || "").trim()
        ),
      ])
    : args.issue.missing_facts;

  const rejectedPositions = Array.isArray(
    parsed.rejected_positions
  )
    ? uniq([
        ...args.issue.rejected_positions,
        ...parsed.rejected_positions.map((x) =>
          String(x || "").trim()
        ),
      ])
    : args.issue.rejected_positions;

  if (safeVerdict === "verified") {
    return {
      ...args.issue,
      status: "verified",
      reasoning: authorityValidation.reasoning,
      confidence:
        retrieval.bestScore >= 0.7 ? "high" : "medium",
      authority_validation: authorityValidation,
    };
  }

  if (safeVerdict === "contradicted") {
    return {
      ...args.issue,
      status: "rejected",
      resolved_position: undefined,
      reasoning: authorityValidation.reasoning,
      rejected_positions: uniq([
        ...rejectedPositions,
        proposedPosition,
      ]),
      confidence:
        retrieval.bestScore >= 0.7 ? "high" : "medium",
      authority_validation: authorityValidation,
    };
  }

  if (safeVerdict === "fact_dependent") {
    return {
      ...args.issue,
      status: "fact_dependent",
      reasoning: authorityValidation.reasoning,
      missing_facts: missingFacts,
      confidence: "medium",
      authority_validation: authorityValidation,
    };
  }

  return {
    ...args.issue,
    authority_validation: authorityValidation,
  };
}

async function verifyIssueResolutionLedgerWithAuthority(args: {
  input: CrosscheckInput;
  issues: IssueResolution[];
}): Promise<IssueResolution[]> {
  if (!args.issues.length) return [];

  const maxIssues = authorityVerificationMaxIssues();

  const candidates = [...args.issues]
    .filter((issue) => issue.status !== "rejected")
    .sort(
      (a, b) =>
        authorityVerificationPriority(b) -
        authorityVerificationPriority(a)
    )
    .slice(0, maxIssues);

  const candidateIds = new Set(
    candidates.map((issue) => issue.issue_id)
  );

  const verified = await Promise.all(
    candidates.map((issue) =>
      verifySingleIssueWithAuthority({
        input: args.input,
        issue,
      }).catch(() => issue)
    )
  );

  const verifiedById = new Map(
    verified.map((issue) => [issue.issue_id, issue])
  );

  return args.issues.map((issue) =>
    candidateIds.has(issue.issue_id)
      ? verifiedById.get(issue.issue_id) || issue
      : issue
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
    responseLanguageInstruction(args.input),
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
    responseLanguageInstruction(args.input),
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
  issueResolutions: IssueResolution[];
}): Promise<NormalizedMemo | null> {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) return null;

  const model =
    env("OPENAI_SYNTH_MODEL") || env("OPENAI_MODEL") || "gpt-4.1-mini";

  const client = new OpenAI({ apiKey });

  const sys = [
    "You are constructing a combined tax memo draft from multiple revised model answers.",
    "You are NOT writing a provider-by-provider comparison. You may summarize material crosscheck convergence, minority disagreement, and the strength of the working position in aggregate without naming individual providers or models.",
    "Build one concise internal memo from surviving claims only.",
    "You MUST exclude claims listed as excluded critical claims.",
    "Do not smooth over unresolved controlling conflicts.",
    "The ISSUE RESOLUTION LEDGER is controlling over provider convergence and draft fluency.",
    "Do not contradict a resolved ledger position.",
    "Do not state unresolved, fact_dependent, or rejected ledger positions as settled facts.",
    "Do not reintroduce positions listed as rejected.",
    "Preserve material branch outcomes and missing-fact dependencies from the ledger.",
    "A supported issue may be stated cautiously, but must not be presented as independently verified unless the ledger status is verified.",
    "Do not invent citations or authorities.",
    treatyReliabilityInstruction(),
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
    responseLanguageInstruction(args.input),
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
    "",
    "ISSUE RESOLUTION LEDGER (CONTROLLING):",
    JSON.stringify(args.issueResolutions, null, 2),
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
  issueResolutions: IssueResolution[];
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
    "9. The ISSUE RESOLUTION LEDGER is controlling. Do not contradict it.",
    "10. Do not silently upgrade fact_dependent or unresolved issues into affirmative conclusions.",
    "11. Do not reintroduce positions listed as rejected.",
    "12. If the ledger contains materially different branch outcomes, preserve those branches in the memo.",
    "13. A supported issue may be stated cautiously, but it has not yet been independently authority-verified.",
    "",
    "OUTPUT RULES",
    "- Write a concise internal memo.",
    "- Do not identify individual providers, model names, or rounds. However, do summarize material crosscheck convergence in aggregate when it helps the user understand the strength of the working position. If a clear majority supports the selected position, you may say that multiple independent analyses converged or that a majority materially aligned. If a meaningful minority view remains, disclose it briefly and explain whether it weakens confidence, identifies a controlling distinction, or warrants further research. Do not present supported positions as independently verified unless the ledger status is verified.",
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
    "ISSUE RESOLUTION LEDGER (CONTROLLING):",
    JSON.stringify(args.issueResolutions, null, 2),
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
  issueResolutions: IssueResolution[];
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
    "ISSUE RESOLUTION LEDGER (CONTROLLING):",
    JSON.stringify(args.issueResolutions, null, 2),
    "",
    "Combined draft:",
    JSON.stringify(args.combinedDraft || {}, null, 2),
    "",
    "You are the final senior tax adjudicator.",
    "Re-derive the answer from surviving claims, not from prose blending.",
    "Do NOT write a provider-by-provider model comparison. You may summarize material convergence and minority disagreement in aggregate when it is relevant to confidence or the recommended working position, without naming providers or models.",
    "Weight round 2 higher than round 1.",
    "Use the combined draft as a candidate, not as unquestioned truth.",
    "Never state excluded critical claims as fact.",
    "If a disputed claim is numeric, directional, scope-defining, or branch-defining and remains unstable, convert it into a missing confirmation or narrow caveat instead of asserting it.",
    "If a recent-law instruction is provided, explicitly distinguish current law from recently enacted, proposed, or future-effective law where material.",
    "The ISSUE RESOLUTION LEDGER is controlling. Do not contradict it.",
    "Do not silently upgrade fact_dependent or unresolved issues into affirmative conclusions.",
    "Do not reintroduce rejected positions.",
    "Preserve materially different branch outcomes identified in the ledger.",
    "Treat supported issues as supported rather than independently verified.",
    "Prefer legal precision over generic completeness.",
    "Do not recommend contacting tax authorities.",
    "Do not invent citations.",
    treatyReliabilityInstruction(),
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
  issueResolutions: IssueResolution[];
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
    "Do NOT write a provider-by-provider comparison. You may preserve concise aggregate crosscheck transparency, including strong convergence, meaningful minority disagreement, and whether the selected position is supported versus independently verified.",
    "Prefer the more legally precise memo where they differ.",
    "Never state excluded critical claims as fact.",
    "The ISSUE RESOLUTION LEDGER is controlling over the candidate memos.",
    "Do not silently resolve unresolved or fact-dependent issues.",
    "Do not reintroduce rejected positions.",
    "Preserve branch outcomes and missing-fact dependencies from the ledger.",
    "Use the combined draft and the round 2 conflict matrix only as support.",
    "If a recent-law instruction is provided, explicitly distinguish current law from recently enacted, proposed, or future-effective law where material.",
    "Do not invent citations or authorities.",
    treatyReliabilityInstruction(),
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
    "ISSUE RESOLUTION LEDGER (CONTROLLING):",
    JSON.stringify(args.issueResolutions, null, 2),
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
    question: [
      responseLanguageInstruction(input),
      "",
      treatyReliabilityInstruction(),
      "",
      buildProviderWorkPrompt(input, providerLabel),
    ].join("\n"),
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
  issueResolutions: IssueResolution[];
}): Promise<NormalizedMemo | null> {
  if (!args.finalMemo) return null;

  const validationRequiresRepair =
    args.legalClaimValidation?.valid === false ||
    args.legalClaimValidation?.severity === "critical" ||
    args.legalClaimValidation?.severity === "material";

  if (
    !args.highRiskProviderConflicts.length &&
    !validationRequiresRepair
  ) {
    return args.finalMemo;
  }

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
    "You are rewriting a final tax memo because a high-risk provider conflict and/or legal-validation failure was detected.",
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
    "7. The ISSUE RESOLUTION LEDGER is controlling. The rewrite may not contradict it.",
    "8. Do not upgrade unresolved or fact-dependent issues into settled conclusions.",
    "9. Do not reintroduce rejected positions.",
    "10. Preserve material branch outcomes and required missing facts.",
    "11. Do not mention providers, models, or internal validation mechanics.",
    "12. Do not invent citations or authorities.",
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
    "ISSUE RESOLUTION LEDGER (CONTROLLING):",
    JSON.stringify(args.issueResolutions, null, 2),
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


function buildLedgerSafeFallbackMemo(args: {
  input: CrosscheckInput;
  issueResolutions: IssueResolution[];
}): NormalizedMemo {
  const verified = args.issueResolutions.filter(
    (issue) => issue.controlling && issue.status === "verified"
  );

  const supported = args.issueResolutions.filter(
    (issue) => issue.controlling && issue.status === "supported"
  );

  const unresolved = args.issueResolutions.filter(
    (issue) => issue.controlling && issue.status === "unresolved"
  );

  const factDependent = args.issueResolutions.filter(
    (issue) => issue.controlling && issue.status === "fact_dependent"
  );

  const rejected = args.issueResolutions.filter(
    (issue) => issue.controlling && issue.status === "rejected"
  );

  const treatment: string[] = [];

  for (const issue of verified) {
    if (issue.resolved_position) {
      treatment.push(
        `Verified: ${issue.issue_label}: ${issue.resolved_position}`
      );
    }
  }

  for (const issue of supported) {
    const position =
      issue.resolved_position || issue.issue_statement;

    treatment.push(
      `Provisionally supported but not independently authority-verified: ${issue.issue_label}: ${position}`
    );
  }

  for (const issue of unresolved) {
    const positions = uniq(
      issue.provider_positions
        .map((position) => position.position)
        .filter(Boolean)
    );

    treatment.push(
      positions.length
        ? `Unresolved controlling issue — ${issue.issue_label}. Competing positions: ${positions.join(
            " | "
          )}`
        : `Unresolved controlling issue — ${issue.issue_label}.`
    );
  }

  for (const issue of factDependent) {
    treatment.push(
      `Fact-dependent controlling issue — ${issue.issue_label}.`
    );
  }

  const requiredConfirmations = uniq([
    ...unresolved.map(
      (issue) =>
        `Resolve controlling issue before reliance: ${issue.issue_label}`
    ),
    ...factDependent.flatMap((issue) =>
      issue.missing_facts.length
        ? issue.missing_facts
        : [`Confirm facts required for: ${issue.issue_label}`]
    ),
    ...supported
      .filter(
        (issue) =>
          issue.authority_validation?.verdict === "insufficient"
      )
      .map(
        (issue) =>
          `Obtain authoritative support before treating as settled: ${issue.issue_label}`
      ),
  ]);

  const unresolvedCount =
    unresolved.length + factDependent.length;

  const executiveSummary =
    unresolvedCount > 0
      ? `TaxAiPro identified ${unresolvedCount} controlling issue(s) that could not be resolved safely from the available provider analysis and authoritative material. Those issues are not presented as settled conclusions below.`
      : supported.length > 0
      ? "TaxAiPro identified provisionally supported positions, but some controlling positions could not be independently authority-verified. They should not be treated as return-ready conclusions without confirmation."
      : verified.length > 0
      ? "TaxAiPro completed the analysis with authority-verified controlling conclusions."
      : "TaxAiPro could not establish a reliance-safe controlling conclusion from the available analysis.";

  const analysis = [
    "This response was produced under TaxAiPro's final integrity safeguard because the generated memo did not clear the final legal-validation gate.",
    "",
    verified.length
      ? `Authority-verified controlling issues: ${verified.length}.`
      : "No controlling issue was upgraded to authority-verified status.",
    supported.length
      ? `Provisionally supported controlling issues: ${supported.length}.`
      : "",
    unresolved.length
      ? `Unresolved controlling issues: ${unresolved.length}.`
      : "",
    factDependent.length
      ? `Fact-dependent controlling issues: ${factDependent.length}.`
      : "",
    rejected.length
      ? `${rejected.length} rejected controlling position(s) were excluded from affirmative conclusions.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return normalizeMemoJson({
    executive_summary: executiveSummary,
    analysis,
    transaction_specific_treatment: treatment,
    required_confirmations: requiredConfirmations,
    recommendation:
      unresolvedCount > 0 || supported.length > 0
        ? "Do not rely on a precise filing, rate, liability, computational, or classification position for the unresolved or unverified issues until the listed confirmations or authoritative support are obtained."
        : "Proceed using the authority-verified conclusions above, subject to the stated facts and assumptions.",
    confidence:
      unresolvedCount > 0
        ? "low"
        : supported.length > 0
        ? "medium"
        : verified.length > 0
        ? "high"
        : "low",
    claims: [],
  });
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





function plainFinalMemoToNormalizedMemo(raw: string): NormalizedMemo {
  const cleaned = normalizeText(raw)
    .replace(/^```(?:json|markdown|md)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const lines = cleaned.split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const executive_summary = lines.slice(0, 3).join(" ");

  return {
    executive_summary: cleanMemoText(executive_summary),
    analysis: cleaned,
    transaction_specific_treatment: [],
    required_confirmations: [],
    recommendation: "",
    confidence: "medium",
    claims: heuristicClaimExtraction(cleaned),
    answer: cleaned,
  };
}

async function runFinalMemoSynthesisWithOpenRouter(args: {
  input: CrosscheckInput;
  prompt: string;
}): Promise<{ memo: NormalizedMemo; provider: ProviderOutput } | null> {
  const model = defaultOpenRouterModels()[0] || "anthropic/claude-sonnet-4.6";
  const started = Date.now();

  const result = await callOpenRouter(
    {
      ...args.input,
      question: args.prompt,
      maxTokens: clampInt(args.input.maxTokens, 1600, 5000, 2800),
    },
    model
  ).catch((e: any) => ({
    provider: "openrouter" as const,
    model,
    status: "error" as const,
    ms: Date.now() - started,
    error: e?.message ? String(e.message) : String(e),
  }));

  if (result.status !== "ok" || !result.text) {
    return {
      memo: normalizeMemoJson({
        executive_summary: "Final answer could not be prepared by the OpenRouter fallback.",
        analysis: result.error || "Unknown OpenRouter finalization error.",
        transaction_specific_treatment: [],
        required_confirmations: [],
        recommendation: "Retry finalization or reduce the analysis thread.",
        confidence: "low",
      }),
      provider: result,
    };
  }

  const memo = plainFinalMemoToNormalizedMemo(result.text);

  return {
    memo,
    provider: {
      provider: "openrouter",
      model,
      status: "ok",
      ms: result.ms,
      text: result.text,
    },
  };
}


async function runFinalMemoSynthesis(input: CrosscheckInput): Promise<CrosscheckResult> {
  const t0 = Date.now();
  const apiKey = env("OPENAI_API_KEY");

  const attempted: ProviderCall[] = [];
  const providers: ProviderOutput[] = [];

  const model =
    env("OPENAI_FINAL_MEMO_MODEL") ||
    env("OPENAI_MERGER_MODEL") ||
    env("OPENAI_ADJUDICATOR_MODEL") ||
    env("OPENAI_SYNTH_MODEL") ||
    env("OPENAI_MODEL") ||
    "gpt-4.1-mini";

  attempted.push({ provider: "openai", model });

  if (!apiKey) {
    return {
      ok: false,
      meta: {
        attempted,
        succeeded: [],
        failed: attempted,
        runtime_ms: Date.now() - t0,
      },
      consensus: {
        answer: "Final answer could not be prepared because OPENAI_API_KEY is not configured.",
        caveats: ["Final synthesis requires a final memo model configuration."],
        followups: [],
        confidence: "low",
        disagreements: [],
      },
      providers: [
        {
          provider: "openai",
          model,
          status: "error",
          ms: Date.now() - t0,
          error: "OPENAI_API_KEY is not configured.",
        },
      ],
    };
  }

  const client = new OpenAI({ apiKey });

  const sys = [
    "You are TaxAiPro's final executive tax memo writer.",
    responseLanguageInstruction(input),
    "",
    treatyReliabilityInstruction(),
    "",
    "You are NOT performing a new preliminary crosscheck.",
    "You are NOT answering only the last follow-up.",
    "You are preparing the FINAL ANSWER from an already-developed analysis thread.",
    "",
    "Your job:",
    "1. Read the original question, all follow-ups, numerical assumptions, prior preliminary answers, caveats, and open confirmations contained in the user prompt.",
    "2. Produce one clean, consolidated, printable executive tax memo.",
    "3. Incorporate all follow-up facts into the final conclusion.",
    "4. Resolve contradictions where possible.",
    "5. If a point remains uncertain, state it as a confirmation item, not as a settled conclusion.",
    "6. Correct loose tax terminology when needed.",
    "7. Do not mention providers, models, prior answers, the thread, or the fact that this is a chat.",
    "8. Do not copy/paste prior answers.",
    "9. Do not invent citations, statutory references, forms, rates, or treaty benefits.",
    "10. If the prompt asks for a numerical illustration, show the calculation clearly.",
    "",
    "Important professional constraints:",
    "- Prefer U.S. trade or business / effectively connected income terminology over permanent establishment unless a treaty analysis is actually relevant.",
    "- Do not say a registered agent is the same as a resident owner, director, or legal representative.",
    "- If no income tax treaty exists or treaty applicability is unclear, say so cautiously and require confirmation.",
    "- Keep the answer conservative and audit-ready.",
    "",
    "Return STRICT JSON ONLY with keys:",
    "executive_summary, analysis, transaction_specific_treatment, required_confirmations, recommendation, confidence.",
    "",
    "Each field must be a string or string array only.",
    "The analysis field must be one plain string, not an object.",
  ].join("\n");

  const user = [
    input.jurisdiction ? `Jurisdiction:\n${input.jurisdiction}` : "",
    input.facts ? `Additional facts:\n${input.facts}` : "",
    input.constraints ? `Constraints:\n${input.constraints}` : "",
    responseLanguageInstruction(input),
    "",
    "Finalization source material:",
    input.question,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const finalMaxTokens = clampInt(input.maxTokens, 3000, 9000, 6500);
    const finalTokenParam = model.startsWith("gpt-5")
      ? { max_completion_tokens: finalMaxTokens }
      : { max_tokens: finalMaxTokens };

    const resp = await withTimeout(
      client.chat.completions.create({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        ...finalTokenParam,
      } as any),
      clampInt(input.timeoutMs, 15_000, 120_000, 60_000)
    );

    const raw = resp.choices?.[0]?.message?.content || "{}";
    const parsed = safeJsonParse<MemoJson>(extractJsonObject(raw));
    const memo = parsed ? normalizeMemoJson(parsed) : parseProviderMemo(raw);

    const provider: ProviderOutput = {
      provider: "openai",
      model,
      status: "ok",
      ms: Date.now() - t0,
      text: raw,
    };

    providers.push(provider);

    const caveats = uniq([
      "Prepared as a final consolidated answer from the analysis thread; remaining factual confirmations should be verified before implementation.",
      ...(memo.required_confirmations.length
        ? ["The conclusion remains conditional on the listed confirmations."]
        : []),
    ]);

    return {
      ok: true,
      meta: {
        attempted,
        succeeded: attempted,
        failed: [],
        runtime_ms: Date.now() - t0,
      },
      consensus: {
        answer: memo.answer,
        caveats,
        followups: memo.required_confirmations,
        confidence: memo.confidence || "medium",
        disagreements: [],
      },
      providers,
    };
  } catch (e: any) {
    const msg = e?.message ? String(e.message) : String(e);
    const openaiProvider: ProviderOutput = {
      provider: "openai",
      model,
      status: msg.toLowerCase().includes("timeout") ? "timeout" : "error",
      ms: Date.now() - t0,
      error: msg,
    };

    // Finalization should not depend on a single direct provider.
    // If OpenAI final memo synthesis fails, fall back to the first configured OpenRouter model.
    const fallbackPrompt = [
      "Prepare one final consolidated executive tax memo from the following source material.",
      responseLanguageInstruction(input),
      "",
      treatyReliabilityInstruction(),
      "",
      "Do not answer only the last follow-up.",
      "Do not copy/paste prior answers.",
      "Synthesize the full thread into one clean final answer.",
      "Return PLAIN TEXT ONLY.",
      "Do not return JSON.",
      "Do not use markdown code fences.",
      "Do not include provider names or conversation labels.",
      "Use clear sections: Executive summary, Facts and assumptions, Recommended structure, U.S. federal income tax treatment, Forms and filings, Numerical illustration, Texas and state considerations, Remaining confirmations, Recommended next steps, Confidence explanation.",
      "",
      input.question,
    ].join("\n");

    const fallback = await runFinalMemoSynthesisWithOpenRouter({
      input,
      prompt: fallbackPrompt,
    }).catch(() => null);

    if (fallback?.provider?.status === "ok") {
      const fallbackAttempt: ProviderCall = {
        provider: "openrouter",
        model: fallback.provider.model,
      };

      return {
        ok: true,
        meta: {
          attempted: [...attempted, fallbackAttempt],
          succeeded: [fallbackAttempt],
          failed: attempted,
          runtime_ms: Date.now() - t0,
        },
        consensus: {
          answer: fallback.memo.answer,
          caveats: uniq([
            "Prepared by fallback final memo synthesis after the primary finalizer failed.",
            `Primary finalizer error: ${msg}`,
            ...(fallback.memo.required_confirmations.length
              ? ["The conclusion remains conditional on the listed confirmations."]
              : []),
          ]),
          followups: fallback.memo.required_confirmations,
          confidence: fallback.memo.confidence === "high" ? "medium" : fallback.memo.confidence,
          disagreements: [],
        },
        providers: [openaiProvider, fallback.provider],
      };
    }

    const fallbackError = fallback?.provider?.error || "OpenRouter fallback did not return a successful final memo.";

    return {
      ok: false,
      meta: {
        attempted: [
          ...attempted,
          {
            provider: "openrouter",
            model: fallback?.provider?.model || defaultOpenRouterModels()[0] || "unknown",
          },
        ],
        succeeded: [],
        failed: [
          ...attempted,
          {
            provider: "openrouter",
            model: fallback?.provider?.model || defaultOpenRouterModels()[0] || "unknown",
          },
        ],
        runtime_ms: Date.now() - t0,
      },
      consensus: {
        answer: "Final answer could not be prepared. Please try again or shorten the analysis thread.",
        caveats: [msg, fallbackError],
        followups: [],
        confidence: "low",
        disagreements: [],
      },
      providers: [
        openaiProvider,
        fallback?.provider || {
          provider: "openrouter",
          model: defaultOpenRouterModels()[0] || "unknown",
          status: "error",
          ms: Date.now() - t0,
          error: fallbackError,
        },
      ],
    };
  }
}


export async function runCrosscheck(
  input: CrosscheckInput
): Promise<CrosscheckResult> {
  if (input.runIntent === "finalize") {
    return runFinalMemoSynthesis(input);
  }

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

  const substantiveRunIntent = input.runIntent || "preliminary";
  const shouldRunFullProviderPanel =
    substantiveRunIntent === "preliminary" ||
    substantiveRunIntent === "followup" ||
    substantiveRunIntent === "refine";

  let providers: ProviderOutput[] =
    shouldRunFullProviderPanel || deepRun
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

  let initialIssueResolutions =
    buildInitialIssueResolutionLedger(reasoningConflictMatrix);

  // Phase 3E:
  // If the conflict matrix produces no usable issue ledger, consolidate
  // controlling provider claims by their underlying legal/mechanical issue.
  // Competing numeric, filing, classification, rate, or applicability
  // positions must become positions within ONE issue rather than separate
  // provisionally-supported issues.
  if (initialIssueResolutions.length === 0) {
    initialIssueResolutions =
      await consolidateControllingProviderClaims({
        input: workingInput,
        artifacts: reasoningArtifacts,
      }).catch(() => []);
  }

  let issueResolutions = initialIssueResolutions;

  if (
    initialIssueResolutions.length &&
    reasoningArtifacts.length >= 2
  ) {
    issueResolutions =
      await adjudicateIssueResolutionLedgerWithOpenAI({
        input: workingInput,
        initialLedger: initialIssueResolutions,
        artifacts: reasoningArtifacts,
        assessments: reasoningAssessments,
        conflictMatrix: reasoningConflictMatrix,
      }).catch(() => initialIssueResolutions);
  }

  if (issueResolutions.length) {
    issueResolutions =
      await verifyIssueResolutionLedgerWithAuthority({
        input: workingInput,
        issues: issueResolutions,
      }).catch(() => issueResolutions);
  }

  const ledgerBlockingIssues = issueResolutions.filter(
    (issue) =>
      issue.controlling &&
      (
        issue.status === "unresolved" ||
        issue.status === "fact_dependent" ||
        issue.status === "rejected"
      )
  );

  if (
    pipelineDecision.mode === "fast_consensus" &&
    ledgerBlockingIssues.length > 0
  ) {
    pipelineDecision = {
      ...pipelineDecision,
      mode: "standard",
      reasons: [
        ...pipelineDecision.reasons,
        `Fast consensus revoked after issue-level adjudication: ${ledgerBlockingIssues.length} controlling issue(s) remain unresolved, fact-dependent, or rejected.`,
      ],
    };
  }

  // Phase 3H — canonical ledger integrity.
  //
  // Authority verification has now had its opportunity to upgrade or reject
  // positions. Before any final synthesis, remove duplicate canonical issues
  // and prevent a merely-supported subissue from settling a closely related
  // unresolved controlling issue.
  issueResolutions =
    await enforceNuclearLedgerIntegrity({
      input: workingInput,
      issues: issueResolutions,
    }).catch(() =>
      enforceCanonicalLedgerIntegrity(
        issueResolutions
      )
    );

  // Generic conflict escalation:
  //
  // Normal TaxAiPro operation remains the 3-5 model crosscheck.
  // Only controlling issues that are STILL unresolved after internal
  // issue-level adjudication are eligible for public-source research.
  //
  // This is jurisdiction-neutral and contains no tax-topic-specific rules.
  const externalConflictEscalation =
    await escalateSevereIssueConflicts({
      input: workingInput,
      issues: issueResolutions,
    }).catch(() => ({
      issues: issueResolutions,
      attempted: 0,
      resolved: 0,
      factDependent: 0,
      unresolved: 0,
    }));

  issueResolutions =
    externalConflictEscalation.issues;

  if (
    externalConflictEscalation.attempted > 0
  ) {
    pipelineDecision.reasons.push(
      `External conflict escalation researched ${externalConflictEscalation.attempted} severe unresolved controlling issue(s): ${externalConflictEscalation.resolved} resolved, ${externalConflictEscalation.factDependent} fact-dependent, ${externalConflictEscalation.unresolved} still unresolved.`
    );
  }

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
      issueResolutions,
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
          issueResolutions,
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
          issueResolutions,
        }).catch(() => null),
      ]);

      finalMemo = await mergeFinalMemosWithOpenAI({
        input: workingInput,
        gpt: gptFinal,
        claude: claudeFinal,
        combinedDraft,
        conflictMatrix2: reasoningConflictMatrix,
        survivingClaims,
        issueResolutions,
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
        issueResolutions,
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

  const legalValidationRequiresRepair =
    legalClaimValidation?.valid === false ||
    legalClaimValidation?.severity === "critical" ||
    legalClaimValidation?.severity === "material";

  if (
    finalMemo &&
    (highRiskProviderConflicts.length || legalValidationRequiresRepair)
  ) {
    finalMemo = await rewriteFinalMemoConservativelyWithOpenAI({
      input: workingInput,
      finalMemo,
      reasoningArtifacts,
      assessments: reasoningAssessments,
      conflictMatrix: reasoningConflictMatrix,
      legalClaimValidation,
      highRiskProviderConflicts,
      freshnessScan: legalFreshnessScan,
      issueResolutions,
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

  // Phase 3F — final integrity gate.
  //
  // A fluent final memo must not bypass a material or critical legal-validation
  // failure merely because provider conflict detection did not independently
  // fire. Allow one final conservative repair pass, then validate the repaired
  // memo again. This is intentionally bounded: no recursive repair loop.
  const finalValidationRequiresRepair =
    legalClaimValidation?.valid === false ||
    legalClaimValidation?.severity === "critical" ||
    legalClaimValidation?.severity === "material";

  if (finalMemo && finalValidationRequiresRepair) {
    finalMemo = await rewriteFinalMemoConservativelyWithOpenAI({
      input: workingInput,
      finalMemo,
      reasoningArtifacts,
      assessments: reasoningAssessments,
      conflictMatrix: reasoningConflictMatrix,
      legalClaimValidation,
      highRiskProviderConflicts,
      freshnessScan: legalFreshnessScan,
      issueResolutions,
    }).catch(() => finalMemo);

    legalClaimValidation = await validateLegalClaimsWithOpenAI({
      input: workingInput,
      finalMemo,
      reasoningArtifacts,
      assessments: reasoningAssessments,
      conflictMatrix: reasoningConflictMatrix,
      freshnessScan: legalFreshnessScan,
    }).catch(() => legalClaimValidation);
  }

  const finalValidationStillUnsafe =
    legalClaimValidation?.severity === "critical" ||
    legalClaimValidation?.severity === "material";

  if (finalMemo && finalValidationStillUnsafe) {
    finalMemo = buildLedgerSafeFallbackMemo({
      input: workingInput,
      issueResolutions,
    });
  }

  // Phase 4 — deterministic final memo acceptance gate.
  //
  // No unresolved, fact-dependent, or rejected controlling position may
  // survive into the delivered memo as an affirmative conclusion.
  const finalMemoLedgerInvariant =
    enforceFinalMemoLedgerInvariant(
      finalMemo,
      issueResolutions
    );

  if (
    finalMemo &&
    !finalMemoLedgerInvariant.safe
  ) {
    finalMemo =
      buildLedgerSafeFallbackMemo({
        input: workingInput,
        issueResolutions,
      });
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
      issue_resolutions: issueResolutions,
    },
    providers,
  };
}
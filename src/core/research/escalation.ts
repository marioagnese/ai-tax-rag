import OpenAI from "openai";
import type {
  CrosscheckInput,
  IssueResolution,
  IssueProviderPosition,
} from "../crosscheck/types";

type ResearchVerdict =
  | "supports_one"
  | "fact_dependent"
  | "unresolved";

type ResearchConfidence =
  | "low"
  | "medium"
  | "high";

type ResearchSourceQuality =
  | "primary"
  | "official_secondary"
  | "mixed"
  | "weak";

type ResearchSource = {
  title: string;
  url: string;
  publisher?: string;
  source_type?: string;
};

type ResearchJson = {
  verdict?: ResearchVerdict;
  selected_position_id?: string;
  rejected_position_ids?: string[];
  reasoning?: string;
  confidence?: ResearchConfidence;
  source_quality?: ResearchSourceQuality;
  missing_facts?: string[];
  sources?: ResearchSource[];
};

type ConflictNature =
  | "equivalent"
  | "complementary"
  | "fact_dependent"
  | "material_conflict";

type ConflictNatureJson = {
  classification?: ConflictNature;
  representative_position_id?: string;
  reasoning?: string;
  missing_facts?: string[];
};

export type ConflictEscalationResult = {
  issues: IssueResolution[];
  attempted: number;
  resolved: number;
  factDependent: number;
  unresolved: number;
};

function env(name: string): string {
  return process.env[name] || "";
}

function uniq(xs: string[]): string[] {
  return Array.from(
    new Set(
      xs
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    )
  );
}

function normalize(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/§/g, " section ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: unknown): string[] {
  const stop = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "this",
    "to",
    "under",
    "was",
    "were",
    "whether",
    "which",
    "with",
  ]);

  return uniq(
    normalize(value)
      .split(" ")
      .filter(
        (token) =>
          token.length >= 2 &&
          !stop.has(token)
      )
  );
}

function overlapRatio(
  a: string[],
  b: string[]
): number {
  if (!a.length || !b.length) return 0;

  const aa = new Set(a);
  const bb = new Set(b);

  let overlap = 0;

  for (const token of aa) {
    if (bb.has(token)) overlap++;
  }

  return overlap /
    Math.min(aa.size, bb.size);
}

function extractJsonObject(
  raw: string
): string {
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");

  if (
    first < 0 ||
    last <= first
  ) {
    return "{}";
  }

  return raw.slice(
    first,
    last + 1
  );
}

function safeJsonParse<T>(
  raw: string
): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function collectUrls(
  value: unknown,
  urls = new Set<string>()
): Set<string> {
  if (
    value === null ||
    value === undefined
  ) {
    return urls;
  }

  if (typeof value === "string") {
    if (
      /^https?:\/\//i.test(value)
    ) {
      urls.add(value);
    }

    return urls;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectUrls(item, urls);
    }

    return urls;
  }

  if (typeof value === "object") {
    for (
      const [key, child]
      of Object.entries(
        value as Record<string, unknown>
      )
    ) {
      if (
        key === "url" &&
        typeof child === "string" &&
        /^https?:\/\//i.test(child)
      ) {
        urls.add(child);
      }

      collectUrls(child, urls);
    }
  }

  return urls;
}

function researchEnabled(): boolean {
  return (
    env(
      "EXTERNAL_CONFLICT_RESEARCH_ENABLED"
    ).toLowerCase() !== "false"
  );
}

function maxResearchIssues(): number {
  const parsed = Number(
    env(
      "EXTERNAL_RESEARCH_MAX_ISSUES"
    ) || "3"
  );

  if (!Number.isFinite(parsed)) {
    return 3;
  }

  return Math.max(
    1,
    Math.min(parsed, 6)
  );
}

function shouldEscalate(
  issue: IssueResolution
): boolean {
  /*
   * THIS IS THE CORE ESCALATION RULE.
   *
   * External research is NOT normal processing.
   *
   * It occurs only when:
   * - the issue is controlling;
   * - internal crosscheck left it unresolved;
   * - there are competing provider positions.
   *
   * Minor/model-language differences should already have
   * been handled upstream by the crosscheck engine.
   */
  return (
    issue.controlling === true &&
    issue.status === "unresolved" &&
    issue.provider_positions.length >= 2
  );
}

function escalationPriority(
  issue: IssueResolution
): number {
  let score = 0;

  score +=
    issue.provider_positions.length * 10;

  score +=
    issue.disagreements.length * 5;

  if (
    issue.confidence === "low"
  ) {
    score += 20;
  }

  /*
   * Numeric/rate/category conflicts deserve higher
   * escalation priority because they are more likely
   * to materially change the user's tax result.
   */
  const text = [
    issue.issue_label,
    issue.issue_statement,
    ...issue.provider_positions.map(
      (x) => x.position
    ),
  ].join(" ");

  if (
    /%|\$|\bcategory\b|\brate\b|\bamount\b|\btaxable\b|\bnontaxable\b|\bexempt\b|\brequired\b|\bnot required\b/i.test(
      text
    )
  ) {
    score += 20;
  }

  return score;
}

function findPositionById(
  positionId: string,
  positions: IssueProviderPosition[]
): IssueProviderPosition | null {
  const match = String(
    positionId || ""
  )
    .trim()
    .toUpperCase()
    .match(/^P([1-9][0-9]*)$/);

  if (!match) {
    return null;
  }

  const index =
    Number(match[1]) - 1;

  if (
    index < 0 ||
    index >= positions.length
  ) {
    return null;
  }

  return positions[index] || null;
}

function positionIdForIndex(
  index: number
): string {
  return `P${index + 1}`;
}

async function classifyConflictNature(args: {
  client: OpenAI;
  input: CrosscheckInput;
  issue: IssueResolution;
}): Promise<{
  classification: ConflictNature;
  representativePositionId?: string;
  reasoning: string;
  missingFacts: string[];
}> {
  const positions =
    args.issue.provider_positions.map(
      (position, index) => ({
        position_id:
          positionIdForIndex(index),
        provider:
          position.provider,
        model:
          position.model,
        position:
          position.position,
      })
    );

  const model =
    env(
      "OPENAI_CONFLICT_CLASSIFIER_MODEL"
    ) ||
    env("OPENAI_RESEARCH_MODEL") ||
    "gpt-5.4-mini";

  const system = [
    "You are TaxAiPro's final pre-research conflict referee.",
    "",
    "You are NOT deciding the tax law.",
    "You are deciding whether multiple AI statements actually require external research.",
    "",
    "Classify the relationship among the candidate positions as exactly one of:",
    "",
    "equivalent",
    "- materially the same legal conclusion expressed differently;",
    "- wording, level of detail, or examples differ but the propositions agree.",
    "",
    "complementary",
    "- different statements that can all be true at the same time;",
    "- one may state a general rule, another a condition, another an application, calculation, filing detail, or consequence;",
    "- complementary statements are NOT a legal conflict.",
    "",
    "fact_dependent",
    "- the positions differ because the stated facts are insufficient to determine which treatment applies;",
    "- identify the missing facts.",
    "",
    "material_conflict",
    "- the positions answer the SAME controlling question with mutually incompatible legal outcomes;",
    "- examples include different rates for the same period, taxable vs non-taxable, filing required vs not required, different mutually exclusive classifications, or materially different numerical treatment caused by different legal rules.",
    "",
    "IMPORTANT:",
    "1. Different wording is not disagreement.",
    "2. A general rule and a more specific implementation of that rule are normally complementary.",
    "3. A methodology statement and a numerical result are normally complementary unless the numerical result contradicts the methodology.",
    "4. Do not manufacture a conflict merely because providers cited different provisions.",
    "5. Do not choose the legally correct position when there is a real material conflict.",
    "",
    "Return STRICT JSON ONLY:",
    "{",
    '  "classification": "equivalent" | "complementary" | "fact_dependent" | "material_conflict",',
    '  "representative_position_id": "P1" | "P2" | null,',
    '  "reasoning": string,',
    '  "missing_facts": string[]',
    "}",
    "",
    "For equivalent or complementary positions, representative_position_id should identify the clearest/most complete existing position.",
    "For material_conflict, representative_position_id must be null.",
  ].join("\\n");

  const user = [
    args.input.jurisdiction
      ? `Jurisdiction context: ${args.input.jurisdiction}`
      : "",
    `Original question:\\n${args.input.question}`,
    args.input.facts
      ? `Relevant facts:\\n${args.input.facts}`
      : "",
    "",
    `ISSUE:\\n${args.issue.issue_statement}`,
    "",
    "POSITIONS:",
    JSON.stringify(
      positions,
      null,
      2
    ),
  ]
    .filter(Boolean)
    .join("\\n\\n");

  try {
    const response =
      await args.client.chat.completions.create({
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
        max_tokens: 700,
      });

    const raw =
      response.choices?.[0]
        ?.message?.content || "{}";

    const parsed =
      safeJsonParse<ConflictNatureJson>(
        extractJsonObject(raw)
      );

    const classification =
      parsed?.classification;

    if (
      classification !== "equivalent" &&
      classification !== "complementary" &&
      classification !== "fact_dependent" &&
      classification !== "material_conflict"
    ) {
      /*
       * Fail conservative:
       * if the classifier itself is unusable,
       * preserve the existing unresolved issue and permit
       * research rather than falsely collapsing a real conflict.
       */
      return {
        classification:
          "material_conflict",
        reasoning:
          "Conflict classification could not be parsed safely; the unresolved issue was conservatively retained for escalation.",
        missingFacts: [],
      };
    }

    return {
      classification,
      representativePositionId:
        String(
          parsed?.representative_position_id ||
          ""
        ).trim() || undefined,
      reasoning:
        String(
          parsed?.reasoning || ""
        ).trim(),
      missingFacts:
        Array.isArray(
          parsed?.missing_facts
        )
          ? parsed!.missing_facts!
              .map((x) =>
                String(x || "").trim()
              )
              .filter(Boolean)
          : [],
    };
  } catch (error: any) {
    return {
      classification:
        "material_conflict",
      reasoning:
        `Conflict classification was unavailable and therefore failed conservatively: ${String(
          error?.message || error
        ).slice(0, 300)}`,
      missingFacts: [],
    };
  }
}

function enoughExternalEvidence(args: {
  parsed: ResearchJson;
  actualUrls: string[];
}): boolean {
  const quality =
    args.parsed.source_quality ||
    "weak";

  const confidence =
    args.parsed.confidence ||
    "low";

  if (
    quality === "primary" &&
    args.actualUrls.length >= 1 &&
    (
      confidence === "high" ||
      confidence === "medium"
    )
  ) {
    return true;
  }

  if (
    quality ===
      "official_secondary" &&
    args.actualUrls.length >= 1 &&
    confidence === "high"
  ) {
    return true;
  }

  if (
    quality === "mixed" &&
    args.actualUrls.length >= 2 &&
    confidence === "high"
  ) {
    return true;
  }

  return false;
}

function researchSourceList(
  parsed: ResearchJson,
  actualUrls: string[]
): ResearchSource[] {
  const allowed =
    new Set(actualUrls);

  const supplied =
    Array.isArray(parsed.sources)
      ? parsed.sources
      : [];

  const verified =
    supplied.filter(
      (source) =>
        source?.url &&
        allowed.has(source.url)
    );

  const knownUrls =
    new Set(
      verified.map(
        (source) => source.url
      )
    );

  for (const url of actualUrls) {
    if (knownUrls.has(url)) {
      continue;
    }

    verified.push({
      title: url,
      url,
    });
  }

  return verified.slice(0, 8);
}

async function researchIssue(args: {
  client: OpenAI;
  input: CrosscheckInput;
  issue: IssueResolution;
}): Promise<IssueResolution> {
  const model =
    env("OPENAI_RESEARCH_MODEL") ||
    "gpt-5.4-mini";

  const positions =
    args.issue.provider_positions.map(
      (position, index) => ({
        position_id: `P${index + 1}`,
        provider:
          position.provider,
        model:
          position.model,
        position:
          position.position,
      })
    );

  const prompt = [
    "You are the external conflict-research stage of TaxAiPro, a multi-model tax crosscheck engine.",
    "",
    "IMPORTANT ROLE LIMITATION:",
    "You are NOT re-answering the user's entire tax question.",
    "You are researching ONE unresolved controlling issue that 3-5 independent AI analyses could not safely reconcile.",
    "",
    "Your job is to determine whether trustworthy PUBLIC SOURCES resolve this specific disagreement.",
    "",
    "RESEARCH RULES:",
    "1. Search the public web.",
    "2. Prefer primary and official sources: legislation, regulations, tax authority material, official guidance, treaty text, official forms/instructions, and court decisions.",
    "3. This is jurisdiction-neutral. Research the jurisdiction relevant to the issue.",
    "4. Commercial commentary may help locate authority but should not override primary authority.",
    "5. Do not decide by provider vote.",
    "6. Do not invent law, citations, effective dates, rates, thresholds, or filing requirements.",
    "7. If different facts could make different positions correct, return fact_dependent.",
    "8. If public research does not clearly resolve the conflict, return unresolved.",
    "9. If one position is clearly supported, return its existing position_id exactly (for example P1 or P2).",
    "10. Do not rewrite, paraphrase, or create a new substantive position.",
    "11. selected_position_id MUST be one of the candidate position IDs supplied below.",
    "",
    "RETURN STRICT JSON ONLY:",
    "{",
    '  "verdict": "supports_one" | "fact_dependent" | "unresolved",',
    '  "selected_position_id": string,',
    '  "rejected_position_ids": string[],',
    '  "reasoning": string,',
    '  "confidence": "low" | "medium" | "high",',
    '  "source_quality": "primary" | "official_secondary" | "mixed" | "weak",',
    '  "missing_facts": string[],',
    '  "sources": [',
    "    {",
    '      "title": string,',
    '      "url": string,',
    '      "publisher": string,',
    '      "source_type": string',
    "    }",
    "  ]",
    "}",
    "",
    args.input.jurisdiction
      ? `Jurisdiction context: ${args.input.jurisdiction}`
      : "",
    args.input.constraints
      ? `Constraints: ${args.input.constraints}`
      : "",
    args.input.facts
      ? `Relevant facts:\n${args.input.facts}`
      : "",
    `Original user question:\n${args.input.question}`,
    "",
    `UNRESOLVED ISSUE:\n${args.issue.issue_statement}`,
    "",
    "COMPETING POSITIONS:",
    JSON.stringify(
      positions,
      null,
      2
    ),
    "",
    args.issue.missing_facts.length
      ? `Already identified missing facts:\n${JSON.stringify(
          args.issue.missing_facts,
          null,
          2
        )}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    /*
     * Built-in web search is invoked ONLY at this
     * escalation stage.
     */
    const response =
      await (args.client as any)
        .responses.create({
          model,
          tools: [
            {
              type: "web_search",
              search_context_size:
                "medium",
            },
          ],
          tool_choice: "auto",
          input: prompt,
        });

    const raw =
      String(
        response?.output_text ||
        ""
      );

    const parsed =
      safeJsonParse<ResearchJson>(
        extractJsonObject(raw)
      );

    if (!parsed) {
      return {
        ...args.issue,
        external_research: {
          attempted: true,
          verdict: "unresolved",
          reasoning:
            "External conflict research ran, but its structured result could not be parsed safely.",
          confidence: "low",
          source_quality: "weak",
          sources: [],
        },
      };
    }

    /*
     * URLs are extracted from the ACTUAL Responses API
     * tool output. Model-generated source URLs are accepted
     * only if they appear in the real web-search response.
     */
    const actualUrls =
      Array.from(
        collectUrls(response)
      ).slice(0, 12);

    const sources =
      researchSourceList(
        parsed,
        actualUrls
      );

    const verdict =
      parsed.verdict ||
      "unresolved";

    if (
      verdict ===
      "fact_dependent"
    ) {
      return {
        ...args.issue,
        status:
          "fact_dependent",
        resolved_position:
          undefined,
        missing_facts: uniq([
          ...args.issue
            .missing_facts,
          ...(parsed.missing_facts ||
            []),
        ]),
        confidence: "low",
        reasoning:
          `${args.issue.reasoning} | External public-source research determined that the conflict depends on unresolved facts rather than a single universally applicable legal result. ${String(
            parsed.reasoning || ""
          ).trim()}`,
        external_research: {
          attempted: true,
          verdict:
            "fact_dependent",
          reasoning:
            String(
              parsed.reasoning || ""
            ).trim(),
          confidence:
            parsed.confidence ||
            "low",
          source_quality:
            parsed.source_quality ||
            "weak",
          sources,
        },
      };
    }

    if (
      verdict !== "supports_one"
    ) {
      return {
        ...args.issue,
        external_research: {
          attempted: true,
          verdict: "unresolved",
          reasoning:
            String(
              parsed.reasoning || ""
            ).trim() ||
            "External public-source research did not resolve the material conflict.",
          confidence:
            parsed.confidence ||
            "low",
          source_quality:
            parsed.source_quality ||
            "weak",
          sources,
        },
      };
    }

    const selected =
      findPositionById(
        parsed.selected_position_id ||
          "",
        args.issue
          .provider_positions
      );

    if (
      !selected ||
      !enoughExternalEvidence({
        parsed,
        actualUrls,
      })
    ) {
      return {
        ...args.issue,
        external_research: {
          attempted: true,
          verdict: "unresolved",
          reasoning:
            selected
              ? "External research suggested a preferred position, but the retrieved public-source evidence was not strong enough to safely resolve the controlling conflict."
              : "External research proposed a conclusion that did not safely map to one of the independently generated provider positions.",
          confidence: "low",
          source_quality:
            parsed.source_quality ||
            "weak",
          sources,
        },
      };
    }

    const rejectedPositions =
      uniq([
        ...args.issue
          .rejected_positions,
        ...(Array.isArray(
          parsed.rejected_position_ids
        )
          ? parsed.rejected_position_ids
              .map((positionId) =>
                findPositionById(
                  positionId,
                  args.issue
                    .provider_positions
                )
              )
              .filter(Boolean)
              .map(
                (position) =>
                  position!.position
              )
          : []),
        ...args.issue.provider_positions
          .filter(
            (position) =>
              position !== selected
          )
          .map(
            (position) =>
              position.position
          ),
      ]);

    return {
      ...args.issue,
      status: "supported",
      resolved_position:
        selected.position,
      disagreements: [],
      rejected_positions:
        rejectedPositions,
      confidence:
        parsed.confidence ===
          "high"
          ? "high"
          : "medium",
      reasoning:
        `${args.issue.reasoning} | External conflict escalation researched public sources because internal multi-model adjudication could not safely resolve this controlling issue. The research supported the selected position over the competing alternatives. ${String(
          parsed.reasoning || ""
        ).trim()}`,
      external_research: {
        attempted: true,
        verdict: "supports_one",
        selected_position:
          selected.position,
        reasoning:
          String(
            parsed.reasoning || ""
          ).trim(),
        confidence:
          parsed.confidence ||
          "medium",
        source_quality:
          parsed.source_quality ||
          "mixed",
        sources,
      },
    };
  } catch (error: any) {
    return {
      ...args.issue,
      external_research: {
        attempted: true,
        verdict: "unresolved",
        reasoning:
          `External conflict research was unavailable: ${String(
            error?.message ||
              error
          ).slice(0, 500)}`,
        confidence: "low",
        source_quality: "weak",
        sources: [],
      },
    };
  }
}

export async function escalateSevereIssueConflicts(args: {
  input: CrosscheckInput;
  issues: IssueResolution[];
}): Promise<ConflictEscalationResult> {
  if (!researchEnabled()) {
    return {
      issues: args.issues,
      attempted: 0,
      resolved: 0,
      factDependent: 0,
      unresolved: 0,
    };
  }

  const apiKey =
    env("OPENAI_API_KEY");

  if (!apiKey) {
    return {
      issues: args.issues,
      attempted: 0,
      resolved: 0,
      factDependent: 0,
      unresolved: 0,
    };
  }

  const candidates =
    args.issues
      .filter(shouldEscalate)
      .sort(
        (a, b) =>
          escalationPriority(b) -
          escalationPriority(a)
      )
      .slice(
        0,
        maxResearchIssues()
      );

  if (!candidates.length) {
    return {
      issues: args.issues,
      attempted: 0,
      resolved: 0,
      factDependent: 0,
      unresolved: 0,
    };
  }

  const client =
    new OpenAI({ apiKey });

  /*
   * FINAL ESCALATION GATE.
   *
   * An issue being marked "unresolved" upstream is not,
   * by itself, enough to justify web research.
   *
   * First determine whether the apparent disagreement is:
   * - equivalent,
   * - complementary,
   * - fact-dependent, or
   * - a genuine material conflict.
   *
   * Only genuine material conflicts reach public research.
   */
  const classified =
    await Promise.all(
      candidates.map(async (issue) => ({
        issue,
        nature:
          await classifyConflictNature({
            client,
            input: args.input,
            issue,
          }),
      }))
    );

  const internallyResolved:
    IssueResolution[] = [];

  const researchCandidates:
    IssueResolution[] = [];

  for (
    const { issue, nature }
    of classified
  ) {
    if (
      nature.classification ===
        "equivalent" ||
      nature.classification ===
        "complementary"
    ) {
      const representative =
        findPositionById(
          nature.representativePositionId ||
            "P1",
          issue.provider_positions
        ) ||
        issue.provider_positions[0];

      internallyResolved.push({
        ...issue,
        status: "supported",
        resolved_position:
          representative?.position ||
          issue.issue_statement,
        disagreements: [],
        confidence: "medium",
        reasoning:
          `${issue.reasoning} | Final escalation gate determined that the surviving provider statements are ${nature.classification}, not a material legal conflict. External research was therefore not triggered. ${nature.reasoning}`,
      });

      continue;
    }

    if (
      nature.classification ===
      "fact_dependent"
    ) {
      internallyResolved.push({
        ...issue,
        status: "fact_dependent",
        resolved_position: undefined,
        missing_facts: uniq([
          ...issue.missing_facts,
          ...nature.missingFacts,
        ]),
        disagreements: [],
        confidence: "low",
        reasoning:
          `${issue.reasoning} | Final escalation gate determined that the apparent conflict is fact-dependent rather than a legal disagreement. External research was not triggered solely to compensate for missing facts. ${nature.reasoning}`,
      });

      continue;
    }

    researchCandidates.push(
      issue
    );
  }

  /*
   * Public-source research is reserved exclusively
   * for genuine material conflicts.
   */
  const researched =
    await Promise.all(
      researchCandidates.map((issue) =>
        researchIssue({
          client,
          input: args.input,
          issue,
        })
      )
    );

  const replacements = [
    ...internallyResolved,
    ...researched,
  ];

  const byId =
    new Map(
      replacements.map(
        (issue) => [
          issue.issue_id,
          issue,
        ]
      )
    );

  const issues =
    args.issues.map(
      (issue) =>
        byId.get(issue.issue_id) ||
        issue
    );

  let resolved = 0;
  let factDependent = 0;
  let unresolved = 0;

  for (const issue of researched) {
    if (
      issue.external_research
        ?.verdict ===
      "supports_one"
    ) {
      resolved++;
    } else if (
      issue.external_research
        ?.verdict ===
      "fact_dependent"
    ) {
      factDependent++;
    } else {
      unresolved++;
    }
  }

  return {
    issues,
    // "attempted" intentionally counts PUBLIC RESEARCH only.
    // Equivalent/complementary/fact-dependent issues resolved
    // by the pre-research referee are not counted as research.
    attempted:
      researched.length,
    resolved,
    factDependent,
    unresolved,
  };
}

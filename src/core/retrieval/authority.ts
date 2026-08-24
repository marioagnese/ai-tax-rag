import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";

export type AuthoritySource = {
  cite: string;
  id: string;
  score: number;
  country: string | null;
  jurisdiction: string | null;
  law_code: string | null;
  article: string | null;
  section: string | null;
  source_type: string | null;
  citation_label: string | null;
  source_url: string | null;
  chunk_id: string | null;
  page_start: number | null;
  page_end: number | null;
  snippet: string;
  text: string;
};

export type AuthorityRetrievalResult = {
  ok: boolean;
  query: string;
  country: string | null;
  bestScore: number;
  sources: AuthoritySource[];
  reason?: string;
};

type ExpandedQueriesJson = {
  queries?: string[];
};

type Candidate = {
  id: string;
  rawScore: number;
  adjustedScore: number;
  bestRank: number;
  metadata: any;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
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
    .replace(/\bsec(?:tion)?\.?\s*/g, " section ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLegalAnchors(value: unknown): string[] {
  const text = normalize(value);
  const anchors = new Set<string>();

  const sectionRegex =
    /\bsection\s+([0-9]{1,4}[a-z]?)\b/g;

  for (const match of text.matchAll(sectionRegex)) {
    const section = String(match[1] || "").trim();
    if (section) anchors.add(section);
  }

  const formRegex =
    /\bform\s+([0-9]{3,5}[a-z]?)\b/g;

  for (const match of text.matchAll(formRegex)) {
    const form = String(match[1] || "").trim();
    if (form) anchors.add(form);
  }

  return Array.from(anchors);
}

function candidateAuthorityText(md: any): string {
  return normalize(
    [
      md?.law_code,
      md?.article,
      md?.section,
      md?.source_type,
      md?.citation_label,
      md?.text,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function anchorBoost(
  anchors: string[],
  md: any
): number {
  if (!anchors.length) return 0;

  const haystack = candidateAuthorityText(md);

  const haystackTokens = new Set(
    haystack.split(" ").filter(Boolean)
  );

  const matches = anchors.filter(
    (anchor) => {
      const normalizedAnchor = normalize(anchor);
      return (
        normalizedAnchor.length > 0 &&
        haystackTokens.has(normalizedAnchor)
      );
    }
  ).length;

  if (!matches) return 0;

  return Math.min(
    0.09,
    0.04 + (matches - 1) * 0.02
  );
}

function jurisdictionBoost(
  requestedCountry: string,
  md: any
): number {
  if (!requestedCountry) return 0;

  const requested =
    normalize(requestedCountry);

  const metadata =
    normalize(
      [
        md?.country,
        md?.jurisdiction,
      ]
        .filter(Boolean)
        .join(" ")
    );

  if (!metadata) return 0;

  if (
    metadata.includes(requested) ||
    requested.includes(metadata)
  ) {
    return 0.035;
  }

  return 0;
}

async function expandAuthorityQueries(args: {
  openai: OpenAI;
  query: string;
  country?: string;
}): Promise<string[]> {
  const base = String(args.query || "").trim();

  if (!base) return [];

  if (
    process.env.AUTHORITY_QUERY_EXPANSION_ENABLED ===
    "false"
  ) {
    return [base];
  }

  const anchors = extractLegalAnchors(base);

  const deterministic = uniq([
    base,
    anchors.length
      ? `${base} ${anchors
          .map((x) => `Section ${x}`)
          .join(" ")}`
      : "",
  ]);

  try {
    const model =
      process.env.AUTHORITY_QUERY_EXPANSION_MODEL ||
      process.env.OPENAI_MODEL ||
      "gpt-4.1-mini";

    const response =
      await args.openai.chat.completions.create({
        model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: [
              "You generate retrieval queries for authoritative tax research.",
              "You do NOT answer the tax question.",
              "Create alternate search formulations that could retrieve the governing statute, regulation, official form instructions, revenue ruling, administrative guidance, treaty provision, or other primary authority.",
              "Preserve explicit Code sections, regulations, forms, jurisdictions, and transaction terminology.",
              "Use materially different legal wording rather than superficial paraphrases.",
              "Return STRICT JSON ONLY:",
              '{ "queries": string[] }',
              "Return 3 to 5 queries.",
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              args.country
                ? `Jurisdiction/country context: ${args.country}`
                : "",
              `Tax issue:\n${base}`,
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
        max_tokens: 500,
      });

    const raw =
      response.choices?.[0]?.message?.content ||
      "{}";

    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");

    if (first < 0 || last <= first) {
      return deterministic;
    }

    const parsed =
      JSON.parse(
        raw.slice(first, last + 1)
      ) as ExpandedQueriesJson;

    const generated =
      Array.isArray(parsed?.queries)
        ? parsed.queries
        : [];

    return uniq([
      ...deterministic,
      ...generated,
    ]).slice(0, 6);
  } catch {
    return deterministic;
  }
}

export async function retrieveAuthority(args: {
  query: string;
  country?: string;
  topK?: number;
  minScore?: number;
}): Promise<AuthorityRetrievalResult> {
  const query =
    String(args.query || "").trim();

  const country =
    String(args.country || "").trim();

  const topK = Math.max(
    1,
    Math.min(args.topK ?? 8, 12)
  );

  // Candidate retrieval should favor recall.
  // The downstream authority verifier decides whether
  // retrieved material actually supports the proposition.
  const minScore =
    args.minScore ??
    Number(
      process.env.AUTHORITY_MIN_SCORE ||
        "0.46"
    );

  if (!query) {
    return {
      ok: false,
      query,
      country: country || null,
      bestScore: 0,
      sources: [],
      reason: "empty_query",
    };
  }

  const openai = new OpenAI({
    apiKey: requireEnv("OPENAI_API_KEY"),
  });

  const pc = new Pinecone({
    apiKey: requireEnv("PINECONE_API_KEY"),
  });

  const index = pc
    .index(requireEnv("PINECONE_INDEX"))
    .namespace(
      requireEnv("PINECONE_NAMESPACE")
    );

  const queries =
    await expandAuthorityQueries({
      openai,
      query,
      country,
    });

  if (!queries.length) {
    return {
      ok: false,
      query,
      country: country || null,
      bestScore: 0,
      sources: [],
      reason: "query_expansion_failed",
    };
  }

  const embeddings =
    await openai.embeddings.create({
      model:
        process.env.AUTHORITY_EMBEDDING_MODEL ||
        "text-embedding-3-small",
      input: queries,
    });

  const anchors =
    extractLegalAnchors(query);

  const candidates =
    new Map<string, Candidate>();

  const queryTopK = Math.max(
    topK,
    Math.min(topK * 2, 20)
  );

  for (
    let queryIndex = 0;
    queryIndex < embeddings.data.length;
    queryIndex++
  ) {
    const vector =
      embeddings.data[queryIndex]
        ?.embedding;

    if (!vector) continue;

    /*
     * First query broadly.
     *
     * We intentionally do not hard-filter by country because
     * inconsistent corpus metadata can otherwise make valid
     * primary authority completely invisible.
     */
    const result =
      await index.query({
        vector,
        topK: queryTopK,
        includeMetadata: true,
      });

    const matches =
      result.matches ?? [];

    matches.forEach(
      (match, rankIndex) => {
        const id =
          String(match.id || "").trim();

        if (!id) return;

        const md: any =
          match.metadata || {};

        const rawScore =
          match.score ?? 0;

        /*
         * Reciprocal-rank contribution rewards a source
         * appearing highly across multiple query formulations.
         */
        const rankBoost =
          0.035 /
          Math.max(1, rankIndex + 1);

        const adjustedScore =
          rawScore +
          rankBoost +
          anchorBoost(anchors, md) +
          jurisdictionBoost(country, md);

        const existing =
          candidates.get(id);

        if (!existing) {
          candidates.set(id, {
            id,
            rawScore,
            adjustedScore,
            bestRank: rankIndex + 1,
            metadata: md,
          });
          return;
        }

        existing.rawScore =
          Math.max(
            existing.rawScore,
            rawScore
          );

        /*
         * Multiple-query recurrence receives a modest bonus.
         * This rewards authorities independently retrieved by
         * different formulations without allowing frequency
         * alone to prove correctness.
         */
        existing.adjustedScore =
          Math.max(
            existing.adjustedScore,
            adjustedScore
          ) + 0.012;

        existing.bestRank =
          Math.min(
            existing.bestRank,
            rankIndex + 1
          );
      }
    );
  }

  const ranked =
    Array.from(
      candidates.values()
    ).sort(
      (a, b) =>
        b.adjustedScore -
        a.adjustedScore
    );

  const bestScore =
    ranked[0]?.rawScore ?? 0;

  if (!ranked.length) {
    return {
      ok: false,
      query,
      country: country || null,
      bestScore,
      sources: [],
      reason: "no_sources",
    };
  }

  /*
   * Sources qualify in either of two ways:
   *
   * 1. ordinary semantic score meets the floor; or
   * 2. slightly lower semantic score is rescued by an exact
   *    statutory/form anchor appearing in the authority.
   *
   * The authority verifier still determines legal support.
   */
  const qualified =
    ranked.filter((candidate) => {
      if (
        candidate.rawScore >= minScore
      ) {
        return true;
      }

      const boosted =
        anchorBoost(
          anchors,
          candidate.metadata
        );

      return (
        boosted > 0 &&
        candidate.rawScore >=
          Math.max(
            0.34,
            minScore - 0.09
          )
      );
    });

  if (!qualified.length) {
    return {
      ok: false,
      query,
      country: country || null,
      bestScore,
      sources: [],
      reason: "weak_retrieval",
    };
  }

  const sources: AuthoritySource[] =
    qualified
      .slice(0, topK)
      .map((candidate, index) => {
        const md: any =
          candidate.metadata || {};

        const fullText =
          typeof md.text === "string"
            ? md.text
            : "";

        return {
          cite: `S${index + 1}`,
          id: candidate.id,
          /*
           * Expose raw vector similarity here.
           * Ranking boosts are retrieval mechanics and must
           * not masquerade as source confidence.
           */
          score:
            candidate.rawScore,
          country:
            md.country ?? null,
          jurisdiction:
            md.jurisdiction ?? null,
          law_code:
            md.law_code ?? null,
          article:
            md.article ?? null,
          section:
            md.section ?? null,
          source_type:
            md.source_type ?? null,
          citation_label:
            md.citation_label ?? null,
          source_url:
            md.source_url ?? null,
          chunk_id:
            md.chunk_id ??
            candidate.id ??
            null,
          page_start:
            md.page_start ?? null,
          page_end:
            md.page_end ?? null,
          snippet:
            fullText.slice(0, 420),
          text:
            fullText.slice(0, 3600),
        };
      });

  return {
    ok: true,
    query,
    country: country || null,
    bestScore,
    sources,
  };
}

export function formatAuthorityContext(
  sources: AuthoritySource[]
): string {
  return sources
    .map((source) => {
      const label =
        source.citation_label ||
        source.law_code ||
        source.source_type ||
        "SOURCE";

      const locator = [
        source.section,
        source.article
          ? `Art. ${source.article}`
          : "",
        source.page_start != null
          ? `pp. ${source.page_start}${
              source.page_end != null
                ? `-${source.page_end}`
                : ""
            }`
          : "",
      ]
        .filter(Boolean)
        .join(" | ");

      return [
        `[${source.cite}] ${label}`,
        `RETRIEVAL SCORE: ${source.score.toFixed(
          4
        )}`,
        source.country
          ? `COUNTRY: ${source.country}`
          : "",
        source.jurisdiction
          ? `JURISDICTION: ${source.jurisdiction}`
          : "",
        locator
          ? `LOCATOR: ${locator}`
          : "",
        source.source_url
          ? `URL: ${source.source_url}`
          : "",
        `TEXT:\n${source.text}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

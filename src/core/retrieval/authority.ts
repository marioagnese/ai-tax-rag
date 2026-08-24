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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export async function retrieveAuthority(args: {
  query: string;
  country?: string;
  topK?: number;
  minScore?: number;
}): Promise<AuthorityRetrievalResult> {
  const query = String(args.query || "").trim();
  const country = String(args.country || "").trim();
  const topK = Math.max(1, Math.min(args.topK ?? 8, 10));
  const minScore = args.minScore ?? 0.55;

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
    .namespace(requireEnv("PINECONE_NAMESPACE"));

  const embedding = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: query,
  });

  const filter: Record<string, any> = {};

  if (country) {
    filter.country = { $eq: country };
  }

  const results = await index.query({
    vector: embedding.data[0].embedding,
    topK,
    includeMetadata: true,
    filter: Object.keys(filter).length ? filter : undefined,
  });

  const matches = results.matches ?? [];
  const bestScore = matches[0]?.score ?? 0;

  if (!matches.length) {
    return {
      ok: false,
      query,
      country: country || null,
      bestScore,
      sources: [],
      reason: "no_sources",
    };
  }

  if (bestScore < minScore) {
    return {
      ok: false,
      query,
      country: country || null,
      bestScore,
      sources: [],
      reason: "weak_retrieval",
    };
  }

  const sources: AuthoritySource[] = matches
    .filter((match) => (match.score ?? 0) >= minScore)
    .slice(0, topK)
    .map((match, index) => {
      const md: any = match.metadata || {};
      const fullText =
        typeof md.text === "string" ? md.text : "";

      return {
        cite: `S${index + 1}`,
        id: String(match.id || ""),
        score: match.score ?? 0,
        country: md.country ?? null,
        jurisdiction: md.jurisdiction ?? null,
        law_code: md.law_code ?? null,
        article: md.article ?? null,
        section: md.section ?? null,
        source_type: md.source_type ?? null,
        citation_label: md.citation_label ?? null,
        source_url: md.source_url ?? null,
        chunk_id: md.chunk_id ?? match.id ?? null,
        page_start: md.page_start ?? null,
        page_end: md.page_end ?? null,
        snippet: fullText.slice(0, 320),
        text: fullText.slice(0, 2600),
      };
    });

  if (!sources.length) {
    return {
      ok: false,
      query,
      country: country || null,
      bestScore,
      sources: [],
      reason: "no_sources_above_threshold",
    };
  }

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
        source.article ? `Art. ${source.article}` : "",
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
        locator ? `LOCATOR: ${locator}` : "",
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

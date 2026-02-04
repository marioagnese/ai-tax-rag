import { fetchWithRetry } from "../../core/net/fetch";
import crypto from "crypto";
import {
  SourcePlugin,
  SourceTarget,
  CrawlParams,
  RawFetchedDoc,
  NormalizedDoc,
  BaseMetadata,
} from "../../core/contracts/source";
import { planaltoHtmlToText, splitBrazilArticles, normalizeWhitespace } from "./parsers/html";

const CTN_URL = "https://www.planalto.gov.br/ccivil_03/leis/l5172compilado.htm";

function isoNow() {
  return new Date().toISOString();
}

function sha256(s: string) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function safeSnippet(text: string, max = 300) {
  const t = normalizeWhitespace(text || "");
  return t.length <= max ? t : t.slice(0, max) + "…";
}

// Try to recover an article number from a "section" label like "Art. 3º" / "Art. 1-A"
function extractArticleFromSection(section?: string): string | undefined {
  if (!section) return undefined;
  const s = section.replace(/\s+/g, " ").trim();

  // Common patterns: "Art. 3º", "Art. 3", "Artigo 3", "ART. 3", "Art. 1-A"
  const m =
    s.match(/\bArt\.?\s*([0-9]+(?:\-[A-Z])?)/i) ||
    s.match(/\bArtigo\s*([0-9]+(?:\-[A-Z])?)/i) ||
    s.match(/\bART\.?\s*([0-9]+(?:\-[A-Z])?)/i);

  return m?.[1];
}

/**
 * Brazil official law source (Planalto).
 * Starter: CTN consolidated text -> split into per-Article documents.
 */
export const BrazilPlanaltoPlugin: SourcePlugin = {
  id: "br.planalto",
  country: "Brazil",
  label: "Brazil — Planalto (CTN consolidated)",

  async listTargets(): Promise<SourceTarget[]> {
    return [
      {
        id: "br.planalto.ctn",
        label: "CTN (Lei 5.172/1966) — texto compilado",
        source_url: CTN_URL,
        format: "html",
        source_type: "Statute",
        law_code: "CTN",
        citation_label: "CTN",
        country: "Brazil",
        language: "pt",
      },
    ];
  },

  async *crawl(target: SourceTarget, params: CrawlParams): AsyncGenerator<RawFetchedDoc> {
    const res = await fetchWithRetry(target.source_url, {
      // let fetchWithRetry set defaults; we just add UA
      headers: {
        "User-Agent": "ai-tax-rag/1.0 (+https://example.local)",
      },
      timeoutMs: 60000,
      retries: 6,
      curlFallback: true,
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch ${target.source_url}: HTTP ${res.status}`);
    }

    const html = await res.text();
    const plain = planaltoHtmlToText(html);
    const articles = splitBrazilArticles(plain);

    const retrieved_at = isoNow();

    // Track IDs to avoid accidental duplicates
    const seen = new Set<string>();

    let count = 0;
    for (const a of articles) {
      if (params?.max_docs && count >= params.max_docs) break;

      const rawText = (a?.text || "").trim();
      const section = (a?.section || "").trim();
      if (!rawText) continue; // skip empty chunks

      // Prefer the parser-provided article, otherwise try to recover from section label
      const articleNum = (a?.article || "").trim() || extractArticleFromSection(section);

      // If we still don't have an article number, we can either:
      // A) skip it, or B) ingest with a hashed pseudo-id.
      // We'll ingest, but NOT label it as an article (citations still work via section/snippet).
      const idCore = articleNum ? `art_${articleNum}` : `sec_${sha256(section + "|" + rawText).slice(0, 10)}`;
      let id = `br_ctn_${idCore}_v1_chunk1`;

      // ensure uniqueness (just in case)
      if (seen.has(id)) {
        id = `br_ctn_${idCore}_${sha256(rawText).slice(0, 8)}_v1_chunk1`;
      }
      seen.add(id);

      const baseMeta: Partial<BaseMetadata> = {
        country: target.country,
        source_type: target.source_type,
        law_code: target.law_code,
        citation_label: target.citation_label,
        source_url: target.source_url,
        publisher: "Planalto",
        language: target.language ?? "pt",
        retrieved_at,
        title: target.label,

        // pinpointing
        article: articleNum,
        section: section || (articleNum ? `Art. ${articleNum}` : undefined),
      };

      yield {
        id,
        source_url: target.source_url,
        format: "text",
        body: rawText,
        metadata: baseMeta,
      };

      count++;
    }
  },

  async normalize(raw: RawFetchedDoc): Promise<NormalizedDoc> {
    const text = normalizeWhitespace(
      typeof raw.body === "string" ? raw.body : raw.body.toString("utf8")
    );

    if (!text.trim()) {
      // Shouldn't happen due to crawl filter, but keep it safe
      throw new Error(`normalize(): empty text for ${raw.id}`);
    }

    const content_hash = sha256(text);

    const metadata: any = {
      // required baseline
      country: raw.metadata?.country ?? "Brazil",
      source_type: raw.metadata?.source_type ?? "Statute",
      source_url: raw.metadata?.source_url ?? raw.source_url,

      // optional but useful
      law_code: raw.metadata?.law_code ?? "CTN",
      citation_label: raw.metadata?.citation_label ?? "CTN",
      publisher: raw.metadata?.publisher ?? "Planalto",
      language: raw.metadata?.language ?? "pt",
      retrieved_at: raw.metadata?.retrieved_at ?? isoNow(),
      title: raw.metadata?.title,

      // pinpointing
      article: raw.metadata?.article,
      section: raw.metadata?.section,

      // versioning
      version: raw.metadata?.version ?? "v1",
      content_hash,
      canonical_id: raw.metadata?.canonical_id ?? raw.id,

      // IMPORTANT for citations UI
      snippet: safeSnippet(text, 300),
    };

    return {
      id: raw.id,
      text,
      metadata,
    };
  },
};

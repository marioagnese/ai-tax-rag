// src/sources/br/planalto.ts
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

/**
 * Default URLs (used only if no env override is provided).
 * Note: www4 portal may render differently. We still try it as fallback.
 */
const DEFAULT_CTN_URLS = [
  "https://www.planalto.gov.br/ccivil_03/leis/l5172compilado.htm",
  "https://www4.planalto.gov.br/legislacao/portal-legis/legislacao-1/leis-ordinarias/lei-no-5-172-de-25-de-outubro-de-1966",
];

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

  const m =
    s.match(/\bArt\.?\s*([0-9]+(?:\-[A-Z])?)/i) ||
    s.match(/\bArtigo\s*([0-9]+(?:\-[A-Z])?)/i) ||
    s.match(/\bART\.?\s*([0-9]+(?:\-[A-Z])?)/i);

  return m?.[1];
}

/**
 * Env overrides:
 *  - PLANALTO_CTN_URL: single URL
 *  - PLANALTO_CTN_URLS: comma-separated URLs (highest priority first)
 */
function getCtnUrlsFromEnv(): string[] {
  const single = (process.env.PLANALTO_CTN_URL || "").trim();
  if (single) return [single];

  const list = (process.env.PLANALTO_CTN_URLS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  return list.length ? list : DEFAULT_CTN_URLS;
}

type FetchAttempt = {
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
};

async function fetchFirstWorkingUrl(
  urls: string[],
  opts: Parameters<typeof fetchWithRetry>[1]
): Promise<{ res: Response; usedUrl: string; attempts: FetchAttempt[] }> {
  const attempts: FetchAttempt[] = [];
  let lastErr: any = null;

  for (const url of urls) {
    try {
      const res = await fetchWithRetry(url, opts);
      if (res.ok) {
        attempts.push({ url, ok: true, status: res.status });
        return { res, usedUrl: url, attempts };
      }
      attempts.push({ url, ok: false, status: res.status, error: `HTTP ${res.status}` });
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e: any) {
      const msg = String(e?.message || e);
      attempts.push({ url, ok: false, error: msg });
      lastErr = e;
    }
  }

  const details = attempts
    .map((a) => `- ${a.url} -> ${a.ok ? "OK" : "FAIL"}${a.status ? ` (HTTP ${a.status})` : ""}${a.error ? ` :: ${a.error}` : ""}`)
    .join("\n");

  throw new Error(
    `Failed to fetch CTN from all candidate URLs.\n${details}\nLast error: ${String(lastErr?.message || lastErr)}`
  );
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
    const urls = getCtnUrlsFromEnv();
    // Put the "primary" (first) URL here for display; crawl() will try all.
    return [
      {
        id: "br.planalto.ctn",
        label: "CTN (Lei 5.172/1966) — texto compilado",
        source_url: urls[0],
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
    // Candidate URLs = env override list OR defaults.
    // Also include target.source_url in case it was customized somewhere else.
    const envUrls = getCtnUrlsFromEnv();
    const urls = Array.from(new Set([target.source_url, ...envUrls].filter(Boolean)));

    const { res, usedUrl } = await fetchFirstWorkingUrl(urls, {
      headers: {
        "User-Agent": "ai-tax-rag/1.0 (+https://example.local)",
      },
      timeoutMs: 60000,
      retries: 6,
      curlFallback: true,
    });

    const html = await res.text();
    const plain = planaltoHtmlToText(html);
    const articles = splitBrazilArticles(plain);

    const retrieved_at = isoNow();
    const seen = new Set<string>();

    let count = 0;
    for (const a of articles) {
      if (params?.max_docs && count >= params.max_docs) break;

      const rawText = (a?.text || "").trim();
      const section = (a?.section || "").trim();
      if (!rawText) continue;

      const articleNum = (a?.article || "").trim() || extractArticleFromSection(section);

      const idCore = articleNum ? `art_${articleNum}` : `sec_${sha256(section + "|" + rawText).slice(0, 10)}`;
      let id = `br_ctn_${idCore}_v1_chunk1`;

      if (seen.has(id)) {
        id = `br_ctn_${idCore}_${sha256(rawText).slice(0, 8)}_v1_chunk1`;
      }
      seen.add(id);

      const baseMeta: Partial<BaseMetadata> = {
        country: target.country,
        source_type: target.source_type,
        law_code: target.law_code,
        citation_label: target.citation_label,

        // IMPORTANT: use the URL that actually worked (for citations)
        source_url: usedUrl,

        publisher: "Planalto",
        language: target.language ?? "pt",
        retrieved_at,
        title: target.label,

        article: articleNum,
        section: section || (articleNum ? `Art. ${articleNum}` : undefined),
      };

      yield {
        id,
        source_url: usedUrl,
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
      throw new Error(`normalize(): empty text for ${raw.id}`);
    }

    const content_hash = sha256(text);

    const metadata: any = {
      country: raw.metadata?.country ?? "Brazil",
      source_type: raw.metadata?.source_type ?? "Statute",
      source_url: raw.metadata?.source_url ?? raw.source_url,

      law_code: raw.metadata?.law_code ?? "CTN",
      citation_label: raw.metadata?.citation_label ?? "CTN",
      publisher: raw.metadata?.publisher ?? "Planalto",
      language: raw.metadata?.language ?? "pt",
      retrieved_at: raw.metadata?.retrieved_at ?? isoNow(),
      title: raw.metadata?.title,

      article: raw.metadata?.article,
      section: raw.metadata?.section,

      version: raw.metadata?.version ?? "v1",
      content_hash,
      canonical_id: raw.metadata?.canonical_id ?? raw.id,

      // citations UI
      snippet: safeSnippet(text, 300),
    };

    return { id: raw.id, text, metadata };
  },
};

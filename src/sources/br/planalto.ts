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

// IMPORTANT: import PDF parser in a resilient way (no more "pdfToText is not a function" loops)
import * as pdfParser from "./parsers/pdf";

// Default candidates (env can override)
const DEFAULT_CTN_URLS = [
  "http://www2.senado.leg.br/bdsf/bitstream/handle/id/496301/000958177.pdf",
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

function parseUrlList(envVal?: string | null): string[] {
  if (!envVal) return DEFAULT_CTN_URLS;
  const parts = envVal
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : DEFAULT_CTN_URLS;
}

async function fetchFirstWorkingUrl(urls: string[]) {
  const failures: Array<{ url: string; reason: string }> = [];

  for (const url of urls) {
    try {
      const res = await fetchWithRetry(url, {
        timeoutMs: 60000,
        retries: 4,
        retryDelayMs: 800,
        curlFallback: true,
        headers: {
          "user-agent": "ai-tax-rag/1.0 (+https://example.local)",
          "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (!res.ok) {
        failures.push({ url, reason: `HTTP ${res.status}` });
        continue;
      }

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      const isPdf = ct.includes("application/pdf") || url.toLowerCase().endsWith(".pdf");

      if (isPdf) {
        const buf = Buffer.from(await res.arrayBuffer());
        return { url, kind: "pdf" as const, body: buf, contentType: ct };
      }

      const html = await res.text();
      return { url, kind: "html" as const, body: html, contentType: ct };
    } catch (e: any) {
      failures.push({ url, reason: String(e?.message || e) });
    }
  }

  const details = failures.map((f) => `- ${f.url} -> ${f.reason}`).join("\n");
  throw new Error(`Failed to fetch CTN from all candidate URLs.\n${details}`);
}

/**
 * Resolve a PDF-to-text function from src/sources/br/parsers/pdf.ts no matter how it exports.
 */
function resolvePdfToText(): (input: Buffer) => Promise<string> {
  const fn =
    (pdfParser as any).pdfToText ||
    (pdfParser as any).default ||
    (pdfParser as any).parsePdf ||
    (pdfParser as any).pdfToString ||
    (pdfParser as any).extractText;

  if (typeof fn !== "function") {
    throw new Error(
      `PDF parser export not found. Expected pdfToText or default export in src/sources/br/parsers/pdf.ts. Found exports: ${Object.keys(
        pdfParser as any
      ).join(", ")}`
    );
  }

  return fn;
}

/**
 * Brazil official law source (multi-url).
 * CTN -> normalize -> split into per-Article documents.
 */
export const BrazilPlanaltoPlugin: SourcePlugin = {
  id: "br.planalto",
  country: "Brazil",
  label: "Brazil — CTN (multi-source: Senado PDF / Planalto HTML)",

  async listTargets(): Promise<SourceTarget[]> {
    // Keep the "canonical" URL for metadata; actual fetch uses BR_CTN_URLS override
    return [
      {
        id: "br.planalto.ctn",
        label: "CTN (Lei 5.172/1966) — texto base",
        source_url: "https://www.planalto.gov.br/ccivil_03/leis/l5172compilado.htm",
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
    const urls = parseUrlList(process.env.BR_CTN_URLS);
    const chosen = await fetchFirstWorkingUrl(urls);

    // Convert to plain text
    let plain: string;
    if (chosen.kind === "pdf") {
      const pdfToText = resolvePdfToText();
      plain = await pdfToText(chosen.body);
    } else {
      plain = planaltoHtmlToText(chosen.body);
    }

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

      const idCore = articleNum
        ? `art_${articleNum}`
        : `sec_${sha256(section + "|" + rawText).slice(0, 10)}`;

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

        // IMPORTANT: store the *actual* fetched URL for traceability
        source_url: chosen.url,
        publisher: chosen.kind === "pdf" ? "Senado (BDSF)" : "Planalto",
        language: target.language ?? "pt",
        retrieved_at,
        title: target.label,

        article: articleNum,
        section: section || (articleNum ? `Art. ${articleNum}` : undefined),
      };

      yield {
        id,
        source_url: chosen.url,
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

    if (!text.trim()) throw new Error(`normalize(): empty text for ${raw.id}`);

    const content_hash = sha256(text);

    const metadata: any = {
      country: raw.metadata?.country ?? "Brazil",
      source_type: raw.metadata?.source_type ?? "Statute",
      source_url: raw.metadata?.source_url ?? raw.source_url,

      law_code: raw.metadata?.law_code ?? "CTN",
      citation_label: raw.metadata?.citation_label ?? "CTN",
      publisher: raw.metadata?.publisher ?? "Unknown",
      language: raw.metadata?.language ?? "pt",
      retrieved_at: raw.metadata?.retrieved_at ?? isoNow(),
      title: raw.metadata?.title,

      article: raw.metadata?.article,
      section: raw.metadata?.section,

      version: raw.metadata?.version ?? "v1",
      content_hash,
      canonical_id: raw.metadata?.canonical_id ?? raw.id,

      // IMPORTANT for citations UI
      snippet: safeSnippet(text, 300),
    };

    return { id: raw.id, text, metadata };
  },
};


// src/core/contracts/citation.ts
/**
 * Citation Contract
 * -----------------
 * These types mirror what your /api/ask returns today (citations array),
 * and what the pipeline should store in Pinecone metadata so we can
 * generate precise, auditable citations.
 */

export type SourceKind =
  | "Statute"
  | "Regulation"
  | "AdministrativeGuidance"
  | "CaseLaw"
  | "Treaty"
  | "CommercialDataset";

export type Citation = {
  /**
   * Short label used in the answer text, e.g. [S1], [S2]
   */
  cite: string;

  /**
   * Vector/chunk id (this should match the Pinecone vector id)
   */
  id: string;

  /**
   * Similarity score from retrieval
   */
  score: number;

  /**
   * Core provenance fields shown to the user
   */
  country: string;
  law_code?: string; // "CTN", "ET", "LISR", etc.
  article?: string; // "3", "1", etc.
  section?: string; // "Art. 3º", "Art. 1", etc.

  source_type: SourceKind;
  citation_label?: string; // "CTN", "Estatuto Tributario", "LISR", etc.
  source_url: string;

  /**
   * Locator fields (optional but recommended)
   */
  chunk_id?: string; // often same as id
  page_start?: number;
  page_end?: number;

  /**
   * Small excerpt displayed to the user
   */
  snippet: string;
};

export type AskResponse =
  | {
      ok: true;
      api_version: string;
      question: string;
      topK: number;
      namespace: string;
      filter: Record<string, any>;
      answer: string;
      citations: Citation[];
    }
  | {
      ok: false;
      api_version?: string;
      error: string;
      question?: string;
      namespace?: string;
      filter?: Record<string, any>;
      bestScore?: number;
    };

/**
 * Helper: convert citations to a stable "sources" block (optional)
 * for logging or memo drafting.
 */
export function formatCitations(citations: Citation[]): string {
  return citations
    .map((c) => {
      const parts = [
        c.citation_label || c.law_code || c.country,
        c.section ? `${c.section}` : c.article ? `Art. ${c.article}` : "",
        c.page_start != null ? `pp. ${c.page_start}${c.page_end != null ? `-${c.page_end}` : ""}` : "",
      ].filter(Boolean);
      return `${c.cite} ${parts.join(" • ")} • ${c.source_url}`;
    })
    .join("\n");
}

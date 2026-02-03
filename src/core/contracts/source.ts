// src/core/contracts/source.ts
/**
 * Source Plugin Contract
 * ----------------------
 * Goal: make every country/data source a plug-in that can be crawled + normalized
 * into a standard "Document" shape that is safe for Pinecone metadata rules.
 *
 * Pinecone metadata constraints (important):
 * - values must be: string | number | boolean | string[]
 * - null/undefined not allowed
 * - avoid nested objects (flatten or drop)
 */

export type SourceType =
  | "Statute"
  | "Regulation"
  | "AdministrativeGuidance"
  | "CaseLaw"
  | "Treaty"
  | "CommercialDataset";

export type ContentFormat = "html" | "pdf" | "text";

/**
 * Common metadata keys we want across ALL countries.
 * Keep values Pinecone-safe.
 */
export type PineconeSafe =
  | string
  | number
  | boolean
  | string[]
  | undefined;

export type PineconeMetadata = Record<string, PineconeSafe>;

/**
 * Minimum metadata we expect in *every* document chunk we ingest.
 * (You can add more, but keep values Pinecone-safe.)
 */
export type BaseMetadata = {
  // jurisdiction identity
  country: string; // e.g. "Brazil"
  jurisdiction?: string; // optional: "Federal", "SP", "RJ", etc.

  // classification
  source_type: SourceType; // Statute, CaseLaw, etc.
  law_code?: string; // e.g. "CTN", "ET", "LISR"
  citation_label?: string; // e.g. "CTN", "Estatuto Tributario"
  language?: string; // "pt", "es", "en"

  // source of truth / provenance
  source_url: string; // canonical URL to verify
  publisher?: string; // e.g. "Planalto", "Función Pública"
  retrieved_at?: string; // ISO timestamp when crawler fetched it
  published_at?: string; // if known (ISO)
  effective_from?: string; // if known (ISO)
  effective_to?: string; // if known (ISO)

  // pinpointing / locating within the source
  title?: string; // document title
  chapter?: string;
  section?: string; // e.g. "Art. 3º"
  article?: string; // e.g. "3"
  paragraph?: string; // if applicable
  item?: string; // inciso / numeral / alínea etc.

  // PDF locator (optional)
  page_start?: number;
  page_end?: number;

  // integrity / versioning
  canonical_id?: string; // stable id across crawls (your own)
  version?: string; // e.g. "v1", date-based version
  content_hash?: string; // sha256 of normalized text (recommended)

  // helpful for retrieval filters
  tags?: string[]; // e.g. ["income_tax", "withholding"]
};

/**
 * What a crawler fetches before normalization (raw).
 */
export type RawFetchedDoc = {
  /**
   * Unique doc id at *document level* (not chunk level).
   * Example: "br_ctn_full_v1"
   */
  id: string;

  /**
   * Where it came from + what it is.
   */
  source_url: string;
  format: ContentFormat;

  /**
   * Raw payload.
   * - for html/text: string
   * - for pdf: Buffer OR base64 string (choose one in your implementation)
   */
  body: string | Buffer;

  /**
   * Early metadata (may be partial). Must remain Pinecone-safe after normalization.
   */
  metadata: Partial<BaseMetadata>;
};

/**
 * Normalized, ready for chunking.
 */
export type NormalizedDoc = {
  /**
   * Unique doc id at *document level*.
   */
  id: string;

  /**
   * Plain text (cleaned) for chunking + embeddings.
   */
  text: string;

  /**
   * Pinecone-safe metadata for the doc.
   * (Chunker will add chunk_id and keep a snippet.)
   */
  metadata: BaseMetadata & PineconeMetadata;
};

/**
 * A crawl "target" is a single authoritative resource to fetch.
 * Example: CTN consolidated page, or a specific PDF for LISR, etc.
 */
export type SourceTarget = {
  id: string; // stable id: e.g. "br.planalto.ctn"
  label: string; // "CTN (Planalto consolidated)"
  source_url: string;
  format: ContentFormat;
  source_type: SourceType;
  law_code?: string;
  citation_label?: string;
  country: string;
  language?: string;
};

/**
 * Crawl input parameters (runner -> plugin).
 */
export type CrawlParams = {
  /**
   * If provided, the plugin MAY try to only update documents changed since this ISO time.
   * Not all sources support it, but keep it in the contract.
   */
  since?: string;

  /**
   * Force re-fetch and re-ingest even if unchanged (hash matches).
   */
  force?: boolean;

  /**
   * Hard cap safety.
   */
  max_docs?: number;
};

/**
 * Crawl output summary (runner uses this for logs/manifests).
 */
export type CrawlSummary = {
  plugin_id: string;
  country: string;
  started_at: string;
  finished_at: string;

  targets_processed: number;
  docs_fetched: number;
  docs_normalized: number;

  // optional stats
  warnings?: string[];
  errors?: string[];
};

/**
 * Main plugin interface.
 * Each country module implements this.
 */
export interface SourcePlugin {
  /**
   * Unique plugin id (stable).
   * Example: "br.planalto"
   */
  id: string;

  country: string;
  label: string;

  /**
   * Return crawlable authoritative targets.
   * (Later: you can support multiple targets, e.g. CTN, IRPJ regs, etc.)
   */
  listTargets(): Promise<SourceTarget[]>;

  /**
   * Fetch raw document(s) for a target.
   * Use an async generator so large sources can stream docs.
   */
  crawl(target: SourceTarget, params: CrawlParams): AsyncGenerator<RawFetchedDoc>;

  /**
   * Convert RawFetchedDoc -> NormalizedDoc (clean text + full metadata).
   * Must produce Pinecone-safe metadata values.
   */
  normalize(raw: RawFetchedDoc): Promise<NormalizedDoc>;
}

// src/core/contracts/ingest.ts
/**
 * Ingest Contract
 * ---------------
 * This is the canonical payload shape that:
 *  - crawlers/plugins produce (after normalization + chunking),
 *  - /api/ingest accepts (manual or automated),
 *  - Pinecone vectors are upserted with.
 *
 * IMPORTANT: Pinecone metadata values must be:
 *   string | number | boolean | string[]
 * No null/undefined. No nested objects.
 */

import type { SourceType, PineconeMetadata, BaseMetadata } from "./source";

export type IngestDefaults = {
  // required
  country: string;
  source_type: SourceType;
  source_url: string;

  // optional
  law_code?: string;
  citation_label?: string;
  publisher?: string;
  language?: string;

  // optional timing/provenance
  retrieved_at?: string;
  published_at?: string;
  effective_from?: string;
  effective_to?: string;

  // optional classification/location
  title?: string;
  chapter?: string;
  section?: string;
  article?: string;
  paragraph?: string;
  item?: string;

  // optional PDF locator
  page_start?: number;
  page_end?: number;

  // extra tags
  tags?: string[];

  /**
   * Allow extra metadata keys (must be Pinecone-safe).
   */
  [k: string]: any;
};

export type IngestDoc = {
  /**
   * Vector ID (chunk ID). Must be globally unique within a namespace.
   * Example: "br_ctn_art_3_v1_chunk1"
   */
  id: string;

  /**
   * Embedding input text (chunked).
   */
  text: string;

  /**
   * Metadata that will be stored with the vector.
   * Must obey Pinecone rules (no nulls, no nested objects).
   */
  metadata?: Partial<BaseMetadata> & PineconeMetadata;
};

export type IngestPayload = {
  /**
   * Applied to every doc (and can be overridden by each doc.metadata).
   */
  defaults: IngestDefaults;

  /**
   * Chunk-level docs (vectors).
   */
  docs: IngestDoc[];
};

export type IngestResult =
  | {
      ok: true;
      index: string;
      namespace: string;
      embed_model: string;
      upserted: number;
    }
  | {
      ok: false;
      error: string;
    };

/**
 * Minimal runtime validation for payloads created by plugins/jobs.
 * (API routes can call this before embedding/upserting.)
 */
export function validateIngestPayload(payload: any): { ok: true } | { ok: false; error: string } {
  if (!payload || typeof payload !== "object") return { ok: false, error: "Payload must be an object" };
  if (!payload.defaults || typeof payload.defaults !== "object") return { ok: false, error: "Missing defaults object" };
  if (!Array.isArray(payload.docs) || payload.docs.length === 0) return { ok: false, error: "docs must be a non-empty array" };

  const d = payload.defaults;
  if (!d.country || typeof d.country !== "string") return { ok: false, error: "defaults.country must be a string" };
  if (!d.source_type || typeof d.source_type !== "string") return { ok: false, error: "defaults.source_type must be a string" };
  if (!d.source_url || typeof d.source_url !== "string") return { ok: false, error: "defaults.source_url must be a string" };

  for (const doc of payload.docs) {
    if (!doc || typeof doc !== "object") return { ok: false, error: "Each doc must be an object" };
    if (!doc.id || typeof doc.id !== "string") return { ok: false, error: "Each doc.id must be a string" };
    if (!doc.text || typeof doc.text !== "string" || !doc.text.trim())
      return { ok: false, error: `Doc ${doc?.id || "(unknown)"} missing non-empty text` };
    if (doc.metadata && typeof doc.metadata !== "object") return { ok: false, error: `Doc ${doc.id} metadata must be an object` };
  }

  return { ok: true };
}

// src/core/contracts/document.ts
/**
 * Document Contract
 * -----------------
 * This defines the normalized document + chunk shapes used across:
 * - crawlers (source plugins)
 * - pipeline (normalize -> chunk -> embed -> upsert)
 * - retrieval (filters / citations)
 *
 * IMPORTANT: Pinecone metadata constraints:
 * - values must be: string | number | boolean | string[]
 * - null/undefined not allowed (omit the key instead)
 * - avoid nested objects
 */

import type { BaseMetadata, PineconeMetadata } from "./source";

export type DocumentId = string;
export type ChunkId = string;

/**
 * A fully normalized document (single "logical" source item).
 * This is produced by a SourcePlugin.normalize().
 */
export type NormalizedDocument = {
  id: DocumentId;

  /** Clean plain text, ready for chunking + embeddings */
  text: string;

  /** Metadata must already be Pinecone-safe */
  metadata: BaseMetadata & PineconeMetadata;
};

/**
 * A chunk derived from a NormalizedDocument.
 * This is the unit we embed + upsert to Pinecone.
 */
export type DocumentChunk = {
  /** Unique chunk id to upsert. Recommendation: `${docId}__c${ordinal}` */
  id: ChunkId;

  /** Parent document id */
  doc_id: DocumentId;

  /** 0-based chunk index */
  ordinal: number;

  /** Chunk text used for embeddings */
  text: string;

  /** Short preview for UI/debug (optional) */
  snippet?: string;

  /**
   * Metadata for this chunk (Pinecone-safe).
   * The pipeline will merge:
   * - document.metadata
   * - chunk locator fields (chunk_id, ordinal, snippet, hashes, etc.)
   */
  metadata: (BaseMetadata & PineconeMetadata) & {
    chunk_id: string;
    chunk_ordinal: number;

    /**
     * Optional: stable integrity values if you compute them in pipeline.
     * Keep them as strings/numbers only.
     */
    doc_hash?: string;
    chunk_hash?: string;
  };
};

/**
 * Chunking result.
 */
export type ChunkedDocument = {
  doc: NormalizedDocument;
  chunks: DocumentChunk[];
};

/**
 * Helper: build a deterministic chunk id.
 */
export function makeChunkId(docId: string, ordinal: number): string {
  return `${docId}__c${ordinal}`;
}

/**
 * Helper: make a safe snippet for UI/debug.
 * (Do NOT put huge text in metadata; keep it short.)
 */
export function makeSnippet(text: string, maxLen = 260): string {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length <= maxLen ? t : t.slice(0, maxLen);
}

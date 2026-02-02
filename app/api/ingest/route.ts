import { NextResponse } from "next/server";
import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/**
 * Pinecone metadata rules:
 * - values must be: string | number | boolean | string[]
 * - no null/undefined
 * - no nested objects (we stringify them)
 */
function sanitizeMetadata(input: any): Record<string, string | number | boolean | string[]> {
  const out: Record<string, string | number | boolean | string[]> = {};

  if (!input || typeof input !== "object") return out;

  for (const [k, v] of Object.entries(input)) {
    if (v === null || v === undefined) continue;

    // primitives
    if (typeof v === "string" || typeof v === "boolean") {
      out[k] = v;
      continue;
    }

    if (typeof v === "number") {
      if (!Number.isFinite(v)) continue;
      out[k] = v;
      continue;
    }

    // arrays -> string[]
    if (Array.isArray(v)) {
      const arr = v
        .filter((x) => x !== null && x !== undefined)
        .map((x) => String(x));
      out[k] = arr;
      continue;
    }

    // objects -> JSON string (so we don't lose info, but stay Pinecone-safe)
    try {
      out[k] = JSON.stringify(v);
    } catch {
      // if it can't stringify, drop it
      continue;
    }
  }

  return out;
}

export async function POST(req: Request) {
  try {
    const INGEST_KEY = requireEnv("INGEST_KEY");
    const OPENAI_API_KEY = requireEnv("OPENAI_API_KEY");
    const PINECONE_API_KEY = requireEnv("PINECONE_API_KEY");
    const PINECONE_INDEX = requireEnv("PINECONE_INDEX");
    const DEFAULT_NAMESPACE = requireEnv("PINECONE_NAMESPACE");

    // simple auth
    const providedKey = req.headers.get("x-ingest-key") || "";
    if (providedKey !== INGEST_KEY) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();

    const defaults = body?.defaults ?? {};
    const docs = body?.docs ?? [];

    if (!Array.isArray(docs) || docs.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Missing docs[] in request body" },
        { status: 400 }
      );
    }

    // allow per-request namespace override, otherwise use env default
    const namespace = (defaults?.namespace || DEFAULT_NAMESPACE) as string;

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
    const index = pc.index(PINECONE_INDEX).namespace(namespace);

    // Validate + prep texts
    const prepared = docs.map((d: any) => {
      const id = String(d?.id || "").trim();
      const text = String(d?.text || "").trim();
      const docMeta = d?.metadata ?? {};

      if (!id) throw new Error("Each doc must include a non-empty id");
      if (!text) throw new Error(`Doc ${id} is missing text`);

      // Combine defaults + per-doc metadata
      const combined = {
        ...defaults,
        ...docMeta,
        // keep a stable identifier in metadata too (handy for debugging)
        chunk_id: id,
        embed_model: "text-embedding-3-small",
        ingested_at: new Date().toISOString(),
        // also store raw text in metadata for retrieval
        text,
      };

      // sanitize to Pinecone-safe metadata
      const safeMetadata = sanitizeMetadata(combined);

      return { id, text, metadata: safeMetadata };
    });

    // Embed
    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: prepared.map((p) => p.text),
    });

    // Upsert vectors
    const vectors = prepared.map((p, i) => ({
      id: p.id,
      values: emb.data[i].embedding,
      metadata: p.metadata,
    }));

    await index.upsert(vectors);

    return NextResponse.json({
      ok: true,
      index: PINECONE_INDEX,
      namespace,
      embed_model: "text-embedding-3-small",
      upserted: vectors.length,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}

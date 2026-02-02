import { NextResponse } from "next/server";
import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function sanitizeMetadata(input: any) {
  // Pinecone metadata values must be: string | number | boolean | string[]
  const out: Record<string, any> = {};

  if (!input || typeof input !== "object") return out;

  for (const [k, v] of Object.entries(input)) {
    if (v === null || v === undefined) continue;

    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") {
      out[k] = v;
      continue;
    }

    if (Array.isArray(v)) {
      // allow list of strings only
      const strings = v.filter((x) => typeof x === "string");
      if (strings.length) out[k] = strings;
      continue;
    }

    // ignore objects, arrays of non-strings, etc.
  }

  return out;
}

export async function POST(req: Request) {
  try {
    const INGEST_KEY = requireEnv("INGEST_KEY");
    const OPENAI_API_KEY = requireEnv("OPENAI_API_KEY");
    const PINECONE_API_KEY = requireEnv("PINECONE_API_KEY");
    const PINECONE_INDEX = requireEnv("PINECONE_INDEX");
    const PINECONE_NAMESPACE = requireEnv("PINECONE_NAMESPACE");

    // simple auth
    const providedKey = req.headers.get("x-ingest-key") || "";
    if (providedKey !== INGEST_KEY) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // expected payload shape:
    // {
    //   defaults: { country, source_type, law_code, source_url, citation_label, ... },
    //   docs: [{ id, text, metadata? }, ...]
    // }
    const body = await req.json();

    const defaults = body?.defaults || {};
    const docs = body?.docs;

    if (!Array.isArray(docs) || docs.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Invalid payload. Provide { defaults: {...}, docs: [{id,text,metadata?}, ...] }" },
        { status: 400 }
      );
    }

    // validate docs
    for (const d of docs) {
      if (!d?.id || !d?.text) {
        return NextResponse.json(
          { ok: false, error: "Each doc needs { id: string, text: string }" },
          { status: 400 }
        );
      }
    }

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
    const index = pc.index(PINECONE_INDEX).namespace(PINECONE_NAMESPACE);

    const texts = docs.map((d: any) => String(d.text));

    // 1) embed
    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: texts,
    });

    // 2) upsert
    const vectors = docs.map((d: any, i: number) => {
      const mergedMd = {
        ...sanitizeMetadata(defaults),
        ...sanitizeMetadata(d.metadata || {}),
        // keep a copy of text for previews/debugging
        text: String(d.text),
        chunk_id: String(d.id),
        embed_model: "text-embedding-3-small",
        ingested_at: new Date().toISOString(),
      };

      return {
        id: String(d.id),
        values: emb.data[i].embedding,
        metadata: mergedMd,
      };
    });

    await index.upsert(vectors);

    return NextResponse.json({
      ok: true,
      index: PINECONE_INDEX,
      namespace: PINECONE_NAMESPACE,
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
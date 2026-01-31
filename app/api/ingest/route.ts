import { NextResponse } from "next/server";
import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";

type IngestDoc = {
  id: string;
  text: string;
  metadata?: Record<string, any>;
};

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    // ---- Basic protection (recommended) ----
    // Set INGEST_API_KEY in Vercel and send header: x-ingest-key
    const INGEST_API_KEY = requireEnv("INGEST_API_KEY");
    const providedKey = req.headers.get("x-ingest-key") || "";
    if (providedKey !== INGEST_API_KEY) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized (bad x-ingest-key)" },
        { status: 401 }
      );
    }

    // ---- Required env vars ----
    const OPENAI_API_KEY = requireEnv("OPENAI_API_KEY");
    const PINECONE_API_KEY = requireEnv("PINECONE_API_KEY");
    const PINECONE_INDEX = requireEnv("PINECONE_INDEX");
    const OPENAI_EMBED_MODEL =
      process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small"; // 1536 dims
    const PINECONE_NAMESPACE = process.env.PINECONE_NAMESPACE || "default";

    // ---- Parse body ----
    // Body shape:
    // {
    //   "docs": [{ id, text, metadata }],
    //   "defaults": { country, source_url, source_type, law_code, ... }  // optional
    // }
    const body = await req.json();
    const docs: IngestDoc[] = Array.isArray(body?.docs) ? body.docs : [];
    const defaults: Record<string, any> = body?.defaults || {};

    if (!docs.length) {
      return NextResponse.json(
        { ok: false, error: "Body must include docs: [{id,text,metadata?}, ...]" },
        { status: 400 }
      );
    }

    // ---- Init clients ----
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
    const index = pc.index(PINECONE_INDEX).namespace(PINECONE_NAMESPACE);

    // ---- Embed in batches ----
    const BATCH = 32;
    let upserted = 0;

    for (let i = 0; i < docs.length; i += BATCH) {
      const slice = docs.slice(i, i + BATCH);

      const emb = await openai.embeddings.create({
        model: OPENAI_EMBED_MODEL,
        input: slice.map((d) => d.text),
      });

      const vectors = slice.map((d, j) => ({
        id: d.id,
        values: emb.data[j].embedding,
        metadata: {
          ...defaults,
          ...(d.metadata || {}),
          // Keep the text in metadata so we can quote/cite it later
          text: d.text,
          // Helpful standard fields if you want them later:
          chunk_id: d.id,
          ingested_at: new Date().toISOString(),
          embed_model: OPENAI_EMBED_MODEL,
        },
      }));

      await index.upsert(vectors);
      upserted += vectors.length;
    }

    return NextResponse.json({
      ok: true,
      index: PINECONE_INDEX,
      namespace: PINECONE_NAMESPACE,
      embed_model: OPENAI_EMBED_MODEL,
      upserted,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";

export async function GET() {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
  const PINECONE_INDEX = process.env.PINECONE_INDEX;

  if (!OPENAI_API_KEY || !PINECONE_API_KEY || !PINECONE_INDEX) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing env var(s). Need OPENAI_API_KEY, PINECONE_API_KEY, PINECONE_INDEX.",
      },
      { status: 500 }
    );
  }

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
  const index = pc.index(PINECONE_INDEX);

  // Dummy “legal” chunks to prove upsert + filtered retrieval
  const docs = [
    {
      id: "mx_lisr_art_1",
      text: "México LISR Artículo 1 (placeholder): scope of income tax.",
      metadata: {
        country: "Mexico",
        doc_type: "Statute",
        law_code: "LISR",
        article: "1",
        page_start: 1,
        page_end: 1,
      },
    },
    {
      id: "br_ctn_art_3",
      text: "Brasil CTN Art. 3º (placeholder): definition of tributo.",
      metadata: {
        country: "Brazil",
        doc_type: "Statute",
        law_code: "CTN",
        article: "3",
        page_start: 1,
        page_end: 1,
      },
    },
  ];

  // 1) Embed
  const emb = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: docs.map((d) => d.text),
  });

  // 2) Upsert into Pinecone
  await index.upsert(
    docs.map((d, i) => ({
      id: d.id,
      values: emb.data[i].embedding,
      metadata: { ...d.metadata, text: d.text },
    }))
  );

  // 3) Query + jurisdiction filter
  const q = "What is the definition of tributo in Brazil?";
  const qEmb = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: q,
  });

  const results = await index.query({
    vector: qEmb.data[0].embedding,
    topK: 5,
    includeMetadata: true,
    filter: { country: { $eq: "Brazil" } },
  });

  return NextResponse.json({
    ok: true,
    query: q,
    top_match: results.matches?.[0]?.id ?? null,
    matches: results.matches ?? [],
  });
}

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const country = (url.searchParams.get("country") || "").trim();
  const topK = Number(url.searchParams.get("topK") || "5");

  if (!q) {
    return NextResponse.json({ ok: false, error: "Missing ?q=" }, { status: 400 });
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
  const PINECONE_INDEX = process.env.PINECONE_INDEX;
  const PINECONE_NAMESPACE = process.env.PINECONE_NAMESPACE || "default";

  if (!OPENAI_API_KEY || !PINECONE_API_KEY || !PINECONE_INDEX) {
    return NextResponse.json(
      { ok: false, error: "Missing env vars. Need OPENAI_API_KEY, PINECONE_API_KEY, PINECONE_INDEX." },
      { status: 500 }
    );
  }

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
  const index = pc.index(PINECONE_INDEX).namespace(PINECONE_NAMESPACE);

  const filter: any = {};
  if (country) filter.country = { $eq: country };

  // 1) embed question
  const qEmb = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: q,
  });

  // 2) retrieve
  const results = await index.query({
    vector: qEmb.data[0].embedding,
    topK: Math.max(1, Math.min(topK, 10)),
    includeMetadata: true,
    filter: Object.keys(filter).length ? filter : undefined,
  });

  const matches = results.matches ?? [];

  // 🚫 IMPORTANT: no sources => no answer
  if (matches.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "No sources found in Pinecone for this query/filter. Ingest documents first.",
        question: q,
        namespace: PINECONE_NAMESPACE,
        filter: Object.keys(filter).length ? filter : null,
      },
      { status: 404 }
    );
  }

  // 3) build citations
  const sources = matches.slice(0, 5).map((m, i) => {
    const cite = `S${i + 1}`;
    const md: any = m.metadata || {};
    const text = String(md.text || "").slice(0, 1200); // keep it small
    return {
      cite,
      id: m.id,
      score: m.score,
      metadata: { ...md, text },
    };
  });

  const context = sources
    .map((s) => {
      const md: any = s.metadata;
      const label = md.citation_label || md.law_code || "SOURCE";
      const article = md.article ? `Art. ${md.article}` : "";
      const url = md.source_url ? `URL: ${md.source_url}` : "";
      return `[${s.cite}] ${label} ${article}\n${url}\nTEXT: ${md.text}\n`;
    })
    .join("\n");

  // 4) answer grounded
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You are a LATAM tax research assistant. Answer ONLY using the provided sources. " +
          "If the sources do not contain enough information, say you don't have enough sources and ask for ingestion. " +
          "Cite sources like [S1], [S2]. Keep it concise and professional.",
      },
      {
        role: "user",
        content: `QUESTION: ${q}\n\nSOURCES:\n${context}`,
      },
    ],
  });

  const answer = completion.choices?.[0]?.message?.content ?? "";

  return NextResponse.json({
    ok: true,
    question: q,
    topK,
    namespace: PINECONE_NAMESPACE,
    filter: Object.keys(filter).length ? filter : null,
    answer,
    sources,
  });
}

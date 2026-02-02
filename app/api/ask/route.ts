import { NextResponse } from "next/server";
import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const country = (url.searchParams.get("country") || "").trim();
    const topK = Number(url.searchParams.get("topK") || "5");

    if (!q) {
      return NextResponse.json({ ok: false, error: "Missing ?q=" }, { status: 400 });
    }

    const OPENAI_API_KEY = requireEnv("OPENAI_API_KEY");
    const PINECONE_API_KEY = requireEnv("PINECONE_API_KEY");
    const PINECONE_INDEX = requireEnv("PINECONE_INDEX");
    const PINECONE_NAMESPACE = requireEnv("PINECONE_NAMESPACE");

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
    const index = pc.index(PINECONE_INDEX).namespace(PINECONE_NAMESPACE);

    const filter: any = {};
    if (country) filter.country = { $eq: country };

    // 1) Embed question
    const qEmb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: q,
    });

    // 2) Retrieve
    const results = await index.query({
      vector: qEmb.data[0].embedding,
      topK: Math.max(1, Math.min(topK, 10)),
      includeMetadata: true,
      filter: Object.keys(filter).length ? filter : undefined,
    });

    const matches = results.matches ?? [];

    // Conservative: no sources => no answer
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

    // UI-ready citations
    const citations = matches.slice(0, 5).map((m, i) => {
      const md: any = m.metadata || {};
      return {
        cite: `S${i + 1}`,
        id: m.id,
        score: m.score,
        country: md.country ?? null,
        law_code: md.law_code ?? null,
        article: md.article ?? null,
        section: md.section ?? null,
        source_type: md.source_type ?? null,
        citation_label: md.citation_label ?? null,
        source_url: md.source_url ?? null,
        chunk_id: md.chunk_id ?? m.id ?? null,
        page_start: md.page_start ?? null,
        page_end: md.page_end ?? null,
        snippet: typeof md.text === "string" ? md.text.slice(0, 260) : "",
      };
    });

    // Context for LLM
    const context = citations
      .map((c) => {
        const label = c.citation_label || c.law_code || "SOURCE";
        const art = c.article ? `Art. ${c.article}` : "";
        const urlLine = c.source_url ? `URL: ${c.source_url}` : "";
        return `[${c.cite}] ${label} ${art}\n${urlLine}\nTEXT: ${c.snippet}\n`;
      })
      .join("\n");

    // 3) Generate grounded answer
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are a LATAM tax research assistant. Answer ONLY using the provided sources. " +
            "If the sources are incomplete, say what is missing. Cite sources like [S1], [S2]. " +
            "Be concise and professional.",
        },
        {
          role: "user",
          content: `QUESTION: ${q}\n\nSOURCES:\n${context}`,
        },
      ],
    });

    const answer = completion.choices?.[0]?.message?.content?.trim() ?? "";

    return NextResponse.json({
      ok: true,
      question: q,
      topK,
      namespace: PINECONE_NAMESPACE,
      filter: Object.keys(filter).length ? filter : null,
      answer,
      citations,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}

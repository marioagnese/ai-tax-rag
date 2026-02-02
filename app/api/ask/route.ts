import { NextResponse } from "next/server";
import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";

const API_VERSION = "ask-v2-citations-2026-02-02";

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
          api_version: API_VERSION,
          error: "No sources found in Pinecone for this query/filter. Ingest documents first.",
          question: q,
          namespace: PINECONE_NAMESPACE,
          filter: Object.keys(filter).length ? filter : null,
        },
        { status: 404 }
      );
    }

    // Conservative: weak match => refuse (prevents accidental hallucination)
    const bestScore = matches?.[0]?.score ?? 0;
    const MIN_SCORE = 0.55; // tune later
    if (bestScore < MIN_SCORE) {
      return NextResponse.json(
        {
          ok: false,
          api_version: API_VERSION,
          error:
            "Retrieved sources are not confident enough (low similarity). Please ingest more relevant documents or refine the question.",
          question: q,
          namespace: PINECONE_NAMESPACE,
          filter: Object.keys(filter).length ? filter : null,
          bestScore,
        },
        { status: 404 }
      );
    }

    // UI-ready citations + include full text for model (capped)
    const citations = matches.slice(0, 5).map((m, i) => {
      const md: any = m.metadata || {};
      const fullText = typeof md.text === "string" ? md.text : "";
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
        // for UI preview
        snippet: fullText.slice(0, 260),
        // for the LLM (kept short enough to avoid prompt blowup)
        text: fullText.slice(0, 2200),
      };
    });

    // Context for LLM (use c.text, not just snippet)
    const context = citations
      .map((c) => {
        const label = c.citation_label || c.law_code || "SOURCE";
        const art = c.article ? `Art. ${c.article}` : "";
        const urlLine = c.source_url ? `URL: ${c.source_url}` : "";
        const pageLine =
          c.page_start || c.page_end ? `PAGES: ${c.page_start ?? ""}-${c.page_end ?? ""}` : "";
        return `[${c.cite}] ${label} ${art}\n${urlLine}\n${pageLine}\nTEXT:\n${c.text}\n`;
      })
      .join("\n");

    // 3) Generate grounded answer (force quoting + citations)
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are a LATAM tax research assistant.\n" +
            "Rules:\n" +
            "1) Answer ONLY using the provided sources.\n" +
            "2) If the sources do not contain the exact information, say what is missing.\n" +
            "3) For definitions, include at least one short direct quote from the source.\n" +
            "4) Cite sources like [S1], [S2] immediately after the sentence they support.\n" +
            "5) Keep it concise and professional.",
        },
        {
          role: "user",
          content: `QUESTION: ${q}\n\nSOURCES:\n${context}`,
        },
      ],
    });

    const answer = completion.choices?.[0]?.message?.content?.trim() ?? "";

    // Remove the heavy "text" field from citations in the response (UI doesn't need it)
    const citationsForUI = citations.map(({ text, ...rest }) => rest);

    return NextResponse.json({
      ok: true,
      api_version: API_VERSION,
      question: q,
      topK,
      namespace: PINECONE_NAMESPACE,
      filter: Object.keys(filter).length ? filter : null,
      answer,
      citations: citationsForUI,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, api_version: API_VERSION, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}

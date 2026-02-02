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
    const PINECONE_NAMESPACE = requireEnv("PINECONE_NAMESPACE"); // ✅ required

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
    const index = pc.index(PINECONE_INDEX).namespace(PINECONE_NAMESPACE);

    const filter: any = {};
    if (country) filter.country = { $eq: country };

    // Embed question
    const qEmb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: q,
    });

    // Retrieve
    const results = await index.query({
      vector: qEmb.data[0].embedding,
      topK: Math.max(1, Math.min(topK, 10)),
      includeMetadata: true,
      filter: Object.keys(filter).length ? filter : undefined,
    });

    const matches = results.matches ?? [];

    // Conservative assistant behavior: no sources => no answer
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

    const sources = matches.slice(0, 5).map((m, i) => {
      const cite = `S${i + 1}`;
      const md: any = m.metadata || {};
      return {
        cite,
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
        // later (PDF): page_start/page_end for click-to-verify by page
        page_start: md.page_start ?? null,
        page_end: md.page_end ?? null,
        // short snippet for UI preview
        snippet: typeof md.text === "string" ? md.text.slice(0, 260) : "",
      };
    });

    // Context fed to LLM (include enough for precise citation)
    const context = sources
      .map((s) => {
        const label = s.citation_label || s.law_code || "SOURCE";
        const art = s.article ? `Art. ${s.article}` : "";
        const urlLine = s.source_url ? `URL: ${s.source_url}` : "";
        return `[${s.cite}] ${label} ${art}\n${urlLine}\nTEXT: ${s.snippet}\n`;
      })
      .join("\n");

    const completion = await openai.chat.completions.create({
      mo

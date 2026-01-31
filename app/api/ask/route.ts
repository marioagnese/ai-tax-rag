import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";

type AskBody = {
  question?: string;
  topK?: number;
  country?: string;
  doc_type?: string;
  law_code?: string;
  article?: string;
};

function buildFilter(body: AskBody) {
  const filters: Record<string, any> = {};
  if (body.country) filters.country = { $eq: body.country };
  if (body.doc_type) filters.doc_type = { $eq: body.doc_type };
  if (body.law_code) filters.law_code = { $eq: body.law_code };
  if (body.article) filters.article = { $eq: body.article };
  return Object.keys(filters).length ? filters : undefined;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AskBody;

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
    const PINECONE_INDEX = process.env.PINECONE_INDEX;
    const PINECONE_NAMESPACE = process.env.PINECONE_NAMESPACE || undefined;

    if (!OPENAI_API_KEY || !PINECONE_API_KEY || !PINECONE_INDEX) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing env var(s). Need OPENAI_API_KEY, PINECONE_API_KEY, PINECONE_INDEX.",
          have: {
            OPENAI_API_KEY: !!OPENAI_API_KEY,
            PINECONE_API_KEY: !!PINECONE_API_KEY,
            PINECONE_INDEX: !!PINECONE_INDEX,
          },
        },
        { status: 500 }
      );
    }

    const question = (body.question || "").trim();
    if (!question) {
      return NextResponse.json({ ok: false, error: "Missing 'question'." }, { status: 400 });
    }

    const topK = Math.min(Math.max(body.topK ?? 5, 1), 10);
    const filter = buildFilter(body);

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const pc = new Pinecone({ apiKey: PINECONE_API_KEY });

    const index = pc.index(PINECONE_INDEX);
    const ns = PINECONE_NAMESPACE ? index.namespace(PINECONE_NAMESPACE) : index;

    // Embed the question
    const qEmb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: question,
    });

    // Retrieve matches
    const results = await ns.query({
      vector: qEmb.data[0].embedding,
      topK,
      includeMetadata: true,
      filter,
    });

    const matches = results.matches ?? [];

    // Build context
    const context = matches
      .map((m, i) => {
        const md = (m.metadata ?? {}) as Record<string, any>;
        const cite = `[S${i + 1}]`;
        const labelParts = [
          md.country ? `country=${md.country}` : null,
          md.law_code ? `law=${md.law_code}` : null,
          md.article ? `art=${md.article}` : null,
        ].filter(Boolean);
        const label = labelParts.length ? labelParts.join(" | ") : "source";
        const text = typeof md.text === "string" ? md.text : "";
        return `${cite} ${label}\n${text}`;
      })
      .join("\n\n");

    // Ask the model to answer with citations
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are a tax research assistant. Use the provided sources. Cite with [S1], [S2], etc. If sources are insufficient, say so.",
        },
        {
          role: "user",
          content: `Question: ${question}\n\nSources:\n${context || "(none)"}`,
        },
      ],
    });

    const answer = completion.choices?.[0]?.message?.content?.trim() ?? "";

    return NextResponse.json({
      ok: true,
      question,
      topK,
      filter: filter ?? null,
      answer,
      sources: matches.map((m, i) => ({
        cite: `S${i + 1}`,
        id: m.id ?? null,
        score: m.score ?? null,
        metadata: m.metadata ?? null,
      })),
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unknown error", name: err?.name ?? null },
      { status: 500 }
    );
  }
}

// Simple GET test in browser:
// /api/ask?q=...&country=Brazil
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  const country = req.nextUrl.searchParams.get("country") || undefined;

  const fake = new Request(req.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: q, country }),
  });

  // @ts-ignore
  return POST(fake as any);
}

import { NextResponse } from "next/server";
import { Pinecone } from "@pinecone-database/pinecone";

export async function GET() {
  const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
  const PINECONE_INDEX = process.env.PINECONE_INDEX;
  const PINECONE_NAMESPACE = process.env.PINECONE_NAMESPACE || "default";

  if (!PINECONE_API_KEY || !PINECONE_INDEX) {
    return NextResponse.json(
      { ok: false, error: "Missing PINECONE_API_KEY or PINECONE_INDEX" },
      { status: 500 }
    );
  }

  const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
  const index = pc.index(PINECONE_INDEX);

  const stats = await index.describeIndexStats();

  // Pinecone returns namespace counts inside stats.namespaces
  const nsInfo = (stats.namespaces as any)?.[PINECONE_NAMESPACE] ?? null;

  return NextResponse.json({
    ok: true,
    index: PINECONE_INDEX,
    namespace: PINECONE_NAMESPACE,
    namespaceInfo: nsInfo, // usually has recordCount
    stats,
  });
}

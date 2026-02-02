import { NextResponse } from "next/server";
import { Pinecone } from "@pinecone-database/pinecone";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    const INGEST_KEY = requireEnv("INGEST_KEY");
    const PINECONE_API_KEY = requireEnv("PINECONE_API_KEY");
    const PINECONE_INDEX = requireEnv("PINECONE_INDEX");
    const PINECONE_NAMESPACE = requireEnv("PINECONE_NAMESPACE");

    const providedKey = req.headers.get("x-ingest-key") || "";
    if (providedKey !== INGEST_KEY) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const ids = body?.ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Provide { ids: string[] }" },
        { status: 400 }
      );
    }

    const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
    const index = pc.index(PINECONE_INDEX).namespace(PINECONE_NAMESPACE);

    // delete by ids
    await index.deleteMany(ids.map((x: any) => String(x)));

    return NextResponse.json({
      ok: true,
      namespace: PINECONE_NAMESPACE,
      deleted: ids,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}

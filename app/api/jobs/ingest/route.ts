// src/app/api/jobs/ingest/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";
import type { NormalizedDoc, SourcePlugin, SourceTarget } from "../../../../src/core/contracts/source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// Pinecone metadata rules: values must be string | number | boolean | string[]
function sanitizeMetadata(input: any): Record<string, any> {
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
      const strArr = v.filter((x) => typeof x === "string") as string[];
      if (strArr.length > 0) out[k] = strArr;
      continue;
    }
  }

  return out;
}

type UpsertDoc = {
  id: string;
  text: string;
  metadata: Record<string, any>;
};

function chunkArray<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function isPlugin(x: any): x is SourcePlugin {
  return (
    x &&
    typeof x === "object" &&
    typeof x.id === "string" &&
    typeof x.country === "string" &&
    typeof x.label === "string" &&
    typeof x.listTargets === "function" &&
    typeof x.crawl === "function" &&
    typeof x.normalize === "function"
  );
}

/**
 * Loads plugins from src/sources (relative to src/app/...).
 * Supports:
 *  - export const plugins = [...]
 *  - export default [...]
 *  - named exports of plugins
 */
async function loadPlugins(): Promise<SourcePlugin[]> {
  const mod: any = await import("../../../../src/sources");

  if (Array.isArray(mod.plugins)) return mod.plugins.filter(isPlugin);
  if (Array.isArray(mod.default)) return mod.default.filter(isPlugin);

  const found: SourcePlugin[] = [];
  for (const v of Object.values(mod)) {
    if (isPlugin(v)) found.push(v);
    if (Array.isArray(v)) for (const item of v) if (isPlugin(item)) found.push(item);
  }

  const byId = new Map<string, SourcePlugin>();
  for (const p of found) byId.set(p.id, p);
  return [...byId.values()];
}

type JobParams = {
  pluginId: string;
  maxDocs?: number;
  embedBatch?: number;
  dryRun?: boolean;
};

async function runIngest(params: JobParams) {
  // Env
  const OPENAI_API_KEY = requireEnv("OPENAI_API_KEY");
  const PINECONE_API_KEY = requireEnv("PINECONE_API_KEY");
  const PINECONE_INDEX = requireEnv("PINECONE_INDEX");
  const PINECONE_NAMESPACE = requireEnv("PINECONE_NAMESPACE");
  const embedModel = process.env.EMBED_MODEL || "text-embedding-3-small";

  // Clients
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
  const index = pc.index(PINECONE_INDEX).namespace(PINECONE_NAMESPACE);

  // Plugins
  const plugins = await loadPlugins();
  if (!plugins.length) {
    throw new Error("No plugins discovered from src/sources. Export a plugin or plugins array.");
  }

  const plugin = plugins.find((p) => p.id === params.pluginId);
  if (!plugin) {
    throw new Error(
      `Plugin not found: ${params.pluginId}. Available: ${plugins.map((p) => p.id).join(", ")}`
    );
  }

  const targets: SourceTarget[] = await plugin.listTargets();

  let totalDocs = 0;
  let totalUpserted = 0;
  const perTarget: Array<{ targetId: string; docs: number; upserted: number; url: string }> = [];

  for (const target of targets) {
    const normalized: NormalizedDoc[] = [];

    for await (const raw of plugin.crawl(target, { max_docs: params.maxDocs })) {
      const doc = await plugin.normalize(raw);
      if (!doc?.id || !doc?.text?.trim()) continue;
      normalized.push(doc);
    }

    totalDocs += normalized.length;

    const nowIso = new Date().toISOString();
    const upsertDocs: UpsertDoc[] = normalized.map((d) => {
      const meta = {
        ...sanitizeMetadata(d.metadata),
        chunk_id: d.id,
        embed_model: embedModel,
        ingested_at: nowIso,
        snippet: d.text.slice(0, 800),
      };
      return { id: d.id, text: d.text, metadata: meta };
    });

    if (params.dryRun) {
      perTarget.push({ targetId: target.id, docs: upsertDocs.length, upserted: 0, url: target.source_url });
      continue;
    }

    const EMBED_BATCH = params.embedBatch ?? 48;
    let upsertedThisTarget = 0;

    for (const batch of chunkArray(upsertDocs, EMBED_BATCH)) {
      const emb = await openai.embeddings.create({
        model: embedModel,
        input: batch.map((b) => b.text),
      });

      const vectors = batch.map((b, i) => ({
        id: b.id,
        values: emb.data[i].embedding,
        metadata: b.metadata,
      }));

      await index.upsert(vectors);
      upsertedThisTarget += vectors.length;
      totalUpserted += vectors.length;
    }

    perTarget.push({
      targetId: target.id,
      docs: upsertDocs.length,
      upserted: upsertedThisTarget,
      url: target.source_url,
    });
  }

  return {
    ok: true,
    plugin: { id: params.pluginId, country: plugin.country, label: plugin.label },
    index: PINECONE_INDEX,
    namespace: PINECONE_NAMESPACE,
    embed_model: embedModel,
    totals: { docs: totalDocs, upserted: totalUpserted },
    targets: perTarget,
    dryRun: !!params.dryRun,
  };
}

/**
 * POST /api/jobs/ingest?plugin=br.planalto&maxDocs=50&embedBatch=32&dryRun=1
 * Header: x-ingest-key: <INGEST_KEY>
 */
export async function POST(req: Request) {
  try {
    const INGEST_KEY = requireEnv("INGEST_KEY");
    const providedKey = req.headers.get("x-ingest-key") || "";
    if (providedKey !== INGEST_KEY) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);

    // pluginId: query first, then JSON body
    let pluginId = url.searchParams.get("plugin") || "";
    let body: any = null;
    try {
      body = await req.json();
    } catch {
      // body optional
    }
    if (!pluginId && body?.pluginId) pluginId = String(body.pluginId);

    if (!pluginId) {
      return NextResponse.json(
        { ok: false, error: "Missing plugin. Use ?plugin=br.planalto or JSON { pluginId: 'br.planalto' }" },
        { status: 400 }
      );
    }

    const maxDocsRaw = url.searchParams.get("maxDocs") ?? body?.maxDocs;
    const embedBatchRaw = url.searchParams.get("embedBatch") ?? body?.embedBatch;
    const dryRunRaw = url.searchParams.get("dryRun") ?? body?.dryRun;

    const maxDocs =
      maxDocsRaw !== undefined && maxDocsRaw !== null && String(maxDocsRaw).length
        ? Number(maxDocsRaw)
        : undefined;

    const embedBatch =
      embedBatchRaw !== undefined && embedBatchRaw !== null && String(embedBatchRaw).length
        ? Number(embedBatchRaw)
        : undefined;

    const dryRun =
      String(dryRunRaw ?? "").toLowerCase() === "1" || String(dryRunRaw ?? "").toLowerCase() === "true";

    const result = await runIngest({ pluginId, maxDocs, embedBatch, dryRun });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Unknown error" }, { status: 500 });
  }
}

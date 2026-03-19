import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/src/lib/auth/session";
import { getAdminDb } from "@/src/lib/firebase/admin";
import { stripe, getPriceIds } from "@/src/lib/stripe/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ThreadMessage = {
  id: string;
  createdAt: number;
  role: "user" | "assistant";
  text: string;
};

type AttachedDoc = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  status: "uploading" | "processing" | "ready" | "error";
  extractedText?: string;
  summary?: string;
  error?: string;
};

type SavedRun = {
  id: string;
  createdAt: number;
  updatedAt?: number;
  title: string;
  jurisdiction?: string;
  facts?: string;
  globalDefaults?: string;
  runOverrides?: string;
  question: string;
  answer?: string;
  caveats?: string[];
  followups?: string[];
  disagreements?: string[];
  confidence?: "low" | "medium" | "high";
  thread?: ThreadMessage[];
  documents?: AttachedDoc[];
};

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean)
    .slice(0, 100);
}

function normalizeConfidence(value: unknown): "low" | "medium" | "high" | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

function normalizeThread(value: unknown): ThreadMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;

      const role = (item as any).role === "assistant" ? "assistant" : "user";
      const text =
        typeof (item as any).text === "string" ? (item as any).text.trim() : "";
      if (!text) return null;

      const id =
        typeof (item as any).id === "string" && (item as any).id.trim()
          ? (item as any).id.trim()
          : crypto.randomUUID();

      const createdAtRaw = Number((item as any).createdAt);
      const createdAt = Number.isFinite(createdAtRaw) ? createdAtRaw : Date.now();

      return {
        id,
        createdAt,
        role,
        text,
      } satisfies ThreadMessage;
    })
    .filter((x): x is ThreadMessage => !!x)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-200);
}

function normalizeDocuments(value: unknown): AttachedDoc[] {
  if (!Array.isArray(value)) return [];

  const out: AttachedDoc[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") continue;

    const name = normalizeString((item as any).name);
    if (!name) continue;

    const status =
      (item as any).status === "uploading" ||
      (item as any).status === "processing" ||
      (item as any).status === "ready" ||
      (item as any).status === "error"
        ? ((item as any).status as AttachedDoc["status"])
        : "ready";

    const id =
      typeof (item as any).id === "string" && (item as any).id.trim()
        ? (item as any).id.trim()
        : crypto.randomUUID();

    const mimeType =
      typeof (item as any).mimeType === "string" && (item as any).mimeType.trim()
        ? (item as any).mimeType.trim()
        : "application/octet-stream";

    const sizeRaw = Number((item as any).size);
    const size = Number.isFinite(sizeRaw) ? sizeRaw : 0;

    out.push({
      id,
      name,
      size,
      mimeType,
      status,
      extractedText: normalizeString((item as any).extractedText),
      summary: normalizeString((item as any).summary),
      error: normalizeString((item as any).error),
    });
  }

  return out.slice(0, 10);
}

async function resolveTierForUserEmail(email: string | undefined): Promise<"0" | "1" | "2"> {
  if (!email) return "0";

  const prices = getPriceIds();
  const tier1PriceId = prices.tier1;
  const tier2PriceId = prices.tier2;

  const customers = await stripe.customers.list({ email, limit: 10 });
  if (!customers.data.length) return "0";

  let best: "0" | "1" | "2" = "0";

  for (const c of customers.data) {
    const subs = await stripe.subscriptions.list({
      customer: c.id,
      status: "all",
      limit: 50,
      expand: ["data.items.data.price"],
    });

    for (const s of subs.data) {
      if (!["active", "trialing", "past_due"].includes(s.status)) continue;

      const metaTier = (s.metadata?.taxaipro_tier || "").trim();
      if (metaTier === "2") return "2";
      if (metaTier === "1") best = best === "2" ? "2" : "1";

      for (const it of s.items.data) {
        const pid = (it.price as any)?.id as string | undefined;
        if (!pid) continue;
        if (pid === tier2PriceId) return "2";
        if (pid === tier1PriceId) best = best === "2" ? "2" : "1";
      }
    }
  }

  return best;
}

function mapRunDoc(data: Record<string, unknown>, fallbackId: string): SavedRun {
  const createdAtRaw = Number(data.createdAt);
  const updatedAtRaw = Number(data.updatedAt);

  return {
    id: normalizeString(data.id) || fallbackId,
    createdAt: Number.isFinite(createdAtRaw) ? createdAtRaw : Date.now(),
    updatedAt: Number.isFinite(updatedAtRaw) ? updatedAtRaw : undefined,
    title: normalizeString(data.title) || "Untitled",
    jurisdiction: normalizeString(data.jurisdiction),
    facts: normalizeString(data.facts),
    globalDefaults: normalizeString(data.globalDefaults),
    runOverrides: normalizeString(data.runOverrides),
    question: normalizeString(data.question) || "",
    answer: normalizeString(data.answer),
    caveats: normalizeStringArray(data.caveats),
    followups: normalizeStringArray(data.followups),
    disagreements: normalizeStringArray(data.disagreements),
    confidence: normalizeConfidence(data.confidence),
    thread: normalizeThread(data.thread),
    documents: normalizeDocuments(data.documents),
  };
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const tier = await resolveTierForUserEmail(user.email);

    if (tier === "0") {
      return NextResponse.json(
        {
          ok: true,
          tier,
          runs: [],
          source: "backend",
          message: "Permanent history is not available on the free tier.",
        },
        { status: 200 }
      );
    }

    const { searchParams } = new URL(req.url);
    const limitRaw = Number(searchParams.get("limit"));
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.floor(limitRaw), 100)
        : 50;

    const db = getAdminDb();

    const snap = await db
      .collection("users")
      .doc(user.uid)
      .collection("runs")
      .orderBy("updatedAt", "desc")
      .limit(limit)
      .get();

    const runs: SavedRun[] = snap.docs.map((doc) =>
      mapRunDoc((doc.data() || {}) as Record<string, unknown>, doc.id)
    );

    return NextResponse.json({
      ok: true,
      tier,
      runs,
      source: "backend",
    });
  } catch (err: any) {
    if (err?.message === "UNAUTHORIZED") {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { ok: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
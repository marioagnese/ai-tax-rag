// app/api/ui/crosscheck/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { requireSessionUser } from "../../../../src/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

type CrosscheckUiBody = {
  jurisdiction?: string;
  facts?: string;
  constraints?: string;
  question?: string;
  timeoutMs?: number;
  maxTokens?: number;
  // allow extra keys but we will ignore them
  [k: string]: unknown;
};

function sanitizeBody(raw: any): CrosscheckUiBody {
  const b: CrosscheckUiBody = raw && typeof raw === "object" ? raw : {};

  // only forward known inputs
  const out: CrosscheckUiBody = {
    jurisdiction: typeof b.jurisdiction === "string" ? b.jurisdiction : undefined,
    facts: typeof b.facts === "string" ? b.facts : undefined,
    constraints: typeof b.constraints === "string" ? b.constraints : undefined,
    question: typeof b.question === "string" ? b.question : undefined,
    timeoutMs: typeof b.timeoutMs === "number" ? b.timeoutMs : undefined,
    maxTokens: typeof b.maxTokens === "number" ? b.maxTokens : undefined,
  };

  return out;
}

export async function POST(req: NextRequest) {
  try {
    // must be logged in to use the UI route
    await requireSessionUser();

    const raw = await req.json().catch(() => ({}));
    const body = sanitizeBody(raw);

    if (!body.question || !body.question.trim()) {
      return NextResponse.json(
        { ok: false, error: "Missing 'question'." },
        { status: 400 }
      );
    }

    const key = requireEnv("CROSSCHECK_KEY");

    const url = new URL("/api/crosscheck", req.nextUrl.origin);

    const upstream = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-crosscheck-key": key,
      },
      body: JSON.stringify(body),
      // prevent any caching at the fetch layer
      cache: "no-store",
    });

    const text = await upstream.text();

    // Pass-through upstream body + status, but prevent caching
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json",
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch (err: any) {
    const msg = err?.message || "Unknown error";

    if (msg === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // surface missing CROSSCHECK_KEY clearly
    if (msg.startsWith("Missing env var:")) {
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }

    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

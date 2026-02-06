// app/api/ui/crosscheck/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// Browser-safe proxy:
// - UI calls /api/ui/crosscheck without any secret header.
// - This route injects x-crosscheck-key server-side and forwards to /api/crosscheck.
export async function POST(req: Request) {
  try {
    const CROSSCHECK_KEY = requireEnv("CROSSCHECK_KEY");

    const body = await req.json().catch(() => ({}));

    // Basic payload shaping + size safety
    const payload = {
      jurisdiction: typeof body.jurisdiction === "string" ? body.jurisdiction.slice(0, 120) : undefined,
      question: typeof body.question === "string" ? body.question.slice(0, 12000) : "",
      facts: typeof body.facts === "string" ? body.facts.slice(0, 20000) : undefined,
      constraints: typeof body.constraints === "string" ? body.constraints.slice(0, 4000) : undefined,
      // optional knobs if you want to expose later
      maxTokens: typeof body.maxTokens === "number" ? body.maxTokens : undefined,
      timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : undefined,
    };

    if (!payload.question.trim()) {
      return NextResponse.json({ ok: false, error: "Missing question" }, { status: 400 });
    }

    const origin = new URL(req.url).origin;
    const upstream = `${origin}/api/crosscheck`;

    const r = await fetch(upstream, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-crosscheck-key": CROSSCHECK_KEY,
      },
      body: JSON.stringify(payload),
      // Prevent caching surprises
      cache: "no-store",
    });

    const text = await r.text();
    // Pass through status + body (usually JSON)
    return new NextResponse(text, {
      status: r.status,
      headers: {
        "Content-Type": r.headers.get("Content-Type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { runCrosscheck } from "../../../src/core/crosscheck/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/**
 * POST /api/crosscheck
 * Header: x-crosscheck-key: <CROSSCHECK_KEY>
 * Body: { question, jurisdiction?, facts?, constraints?, timeoutMs?, maxTokens? }
 */
export async function POST(req: Request) {
  try {
    const key = requireEnv("CROSSCHECK_KEY");
    const provided = req.headers.get("x-crosscheck-key") || "";
    if (provided !== key) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));

    const question = String(body?.question || "").trim();
    if (!question) {
      return NextResponse.json({ ok: false, error: "Missing 'question' in JSON body." }, { status: 400 });
    }

    const jurisdiction = body?.jurisdiction ? String(body.jurisdiction) : undefined;
    const facts = body?.facts ? String(body.facts) : undefined;
    const constraints = body?.constraints ? String(body.constraints) : undefined;

    const timeoutMs = body?.timeoutMs ? Number(body.timeoutMs) : undefined;
    const maxTokens = body?.maxTokens ? Number(body.maxTokens) : undefined;

    const result = await runCrosscheck({ question, jurisdiction, facts, constraints, timeoutMs, maxTokens });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Unknown error" }, { status: 500 });
  }
}

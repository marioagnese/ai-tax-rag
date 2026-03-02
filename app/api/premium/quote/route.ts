import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    if (!body?.name || !body?.email || !body?.jurisdiction || !body?.category || !body?.summary || !body?.facts) {
      return NextResponse.json({ ok: false, error: "Missing required fields." }, { status: 400 });
    }

    // TODO (later): send email / store in DB
    console.log("[premium/quote] new request:", {
      name: body.name,
      email: body.email,
      jurisdiction: body.jurisdiction,
      category: body.category,
      urgency: body.urgency,
      deliverable: body.deliverable,
      hasThread: Array.isArray(body.thread) && body.thread.length > 0,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}

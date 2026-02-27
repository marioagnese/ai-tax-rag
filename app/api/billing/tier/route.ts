// app/api/billing/tier/route.ts
import { NextResponse } from "next/server";
import { requireSessionUser } from "../../../../src/lib/auth/session";
import { getTierForEmail } from "../../../../src/lib/billing/tier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireSessionUser();

    const email = (user.email || "").trim();
    if (!email) {
      return NextResponse.json(
        { ok: false, error: "Missing user email on session. Cannot lookup tier." },
        { status: 400 }
      );
    }

    const result = await getTierForEmail(email);

    return NextResponse.json({
      ok: true,
      tier: result.tier,
      customerId: result.customerId || null,
      activePriceIds: result.activePriceIds,
    });
  } catch (err: any) {
    const msg = err?.message || "Unknown error";
    if (msg === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
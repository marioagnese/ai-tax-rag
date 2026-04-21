// app/api/billing/tier/route.ts
import { NextResponse } from "next/server";
import { requireSessionUser } from "../../../../src/lib/auth/session";
import { resolveTierForUserEmail } from "../../../../src/lib/billing/resolveTier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireSessionUser();
    const tier = await resolveTierForUserEmail(user.email);
    return NextResponse.json({ ok: true, tier });
  } catch (err: any) {
    if (err?.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: err?.message || "Unknown error" }, { status: 500 });
  }
}
// app/api/auth/logout/route.ts
import { NextResponse } from "next/server";
import { clearSessionCookie } from "../../../../src/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    // Still attempt to clear cookie behaviorally; but if something truly failed:
    return NextResponse.json({ ok: false, error: e?.message || "Logout failed" }, { status: 500 });
  }
}
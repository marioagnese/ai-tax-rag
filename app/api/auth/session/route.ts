import { NextResponse } from "next/server";
import { getSessionUser } from "@/src/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  return NextResponse.json({ ok: true, user });
}

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/src/lib/auth/session";

export async function POST() {
  const c: any = cookies();
  // Next 15/16 cookies() may be async in some setups; handle both:
  const store = typeof c?.then === "function" ? await c : c;

  store.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });

  return NextResponse.json({ ok: true });
}

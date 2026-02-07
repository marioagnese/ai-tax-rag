import { NextResponse } from "next/server";
import { requireSessionUser } from "@/src/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    // Require login
    await requireSessionUser();

    // Inject CROSSCHECK_KEY server-side (never expose to browser)
    const CROSSCHECK_KEY = requireEnv("CROSSCHECK_KEY");

    const body = await req.text();
    const url = new URL(req.url);
    const target = new URL("/api/crosscheck", url.origin);

    const upstream = await fetch(target.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-crosscheck-key": CROSSCHECK_KEY,
      },
      body,
    });

    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json",
      },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Proxy error" }, { status: 401 });
  }
}

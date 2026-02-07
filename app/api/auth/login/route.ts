import { NextResponse } from "next/server";
import { adminAuth } from "@/src/lib/firebase/admin";
import { SESSION_COOKIE_NAME } from "@/src/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    const { idToken } = (await req.json()) as { idToken?: string };
    if (!idToken) {
      return NextResponse.json({ ok: false, error: "Missing idToken" }, { status: 400 });
    }

    // Optional: restrict to allowlist domain(s)
    const allowedDomainsRaw = process.env.ALLOWED_EMAIL_DOMAINS || "";
    const allowedDomains = allowedDomainsRaw.split(",").map(s => s.trim()).filter(Boolean);

    const decoded = await adminAuth().verifyIdToken(idToken);
    if (allowedDomains.length && decoded.email) {
      const domain = decoded.email.split("@")[1]?.toLowerCase();
      if (!domain || !allowedDomains.includes(domain)) {
        return NextResponse.json({ ok: false, error: "Email domain not allowed" }, { status: 403 });
      }
    }

    const expiresInDays = Number(process.env.SESSION_DAYS || "7");
    const expiresIn = Math.max(1, Math.min(expiresInDays, 30)) * 24 * 60 * 60 * 1000;

    const sessionCookie = await adminAuth().createSessionCookie(idToken, { expiresIn });

    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(expiresIn / 1000),
    });

    // sanity: ensure cookie secret exists (not used here, but helps validate env)
    if (process.env.NODE_ENV === "production") requireEnv("CROSSCHECK_KEY");

    return res;
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Login failed" }, { status: 500 });
  }
}

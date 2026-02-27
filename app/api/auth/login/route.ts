import { NextResponse, type NextRequest } from "next/server";
import { getAdminAuth, firebaseAdminConfigured } from "../../../../src/lib/firebase/admin";
import { SESSION_COOKIE_NAME, mintSessionToken } from "../../../../src/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function trySendWelcomeEmail(req: NextRequest, args: { email?: string; name?: string }) {
  const email = (args.email || "").trim();
  if (!email) return;

  const name =
    (args.name || "").trim() ||
    email.split("@")[0] ||
    "there";

  try {
    const url = new URL("/api/email/welcome", req.url);
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name }),
    });
  } catch {
    // best-effort; never block login
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!firebaseAdminConfigured()) {
      return NextResponse.json(
        { ok: false, error: "Firebase Admin not configured (missing FIREBASE_* env vars)." },
        { status: 501 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const idToken = String(body?.idToken || "");
    if (!idToken) {
      return NextResponse.json({ ok: false, error: "Missing idToken" }, { status: 400 });
    }

    const allowedDomainsRaw = process.env.ALLOWED_EMAIL_DOMAINS || "";
    const allowedDomains = allowedDomainsRaw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const adminAuth = getAdminAuth();
    const decoded = await adminAuth.verifyIdToken(idToken);

    if (allowedDomains.length && decoded.email) {
      const domain = decoded.email.split("@")[1]?.toLowerCase();
      if (!domain || !allowedDomains.includes(domain)) {
        return NextResponse.json({ ok: false, error: "Email domain not allowed" }, { status: 403 });
      }
    }

    // ✅ Detect "first-time" user and send welcome email once
    // Uses Firebase Auth metadata: creationTime vs lastSignInTime.
    try {
      const user = await adminAuth.getUser(decoded.uid);
      const created = user?.metadata?.creationTime || "";
      const last = user?.metadata?.lastSignInTime || "";

      const looksNew = !!created && (!last || created === last);

      if (looksNew) {
        await trySendWelcomeEmail(req, {
          email: decoded.email,
          name: decoded.name,
        });
      }
    } catch {
      // best-effort; ignore user lookup failures
    }

    const sessionToken = mintSessionToken({
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      picture: decoded.picture,
    });

    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Login failed" }, { status: 500 });
  }
}
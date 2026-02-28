// app/api/email/subscription/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { requireSessionUser } from "../../../../src/lib/auth/session";
import { stripe } from "../../../../src/lib/stripe/server";
import { sendEmail } from "../../../../src/email/sendgrid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  tier?: "1" | "2";
  session_id?: string;
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => {
    const m: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return m[c] || c;
  });
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();

    const body = (await req.json().catch(() => ({}))) as Body;

    const tier = body?.tier;
    const sessionId = (body?.session_id || "").trim();

    if (tier !== "1" && tier !== "2") {
      return NextResponse.json({ ok: false, error: "Missing/invalid tier" }, { status: 400 });
    }

    if (!sessionId) {
      return NextResponse.json({ ok: false, error: "Missing session_id" }, { status: 400 });
    }

    // Verify session_id belongs to this user (best-effort safety without webhooks)
    const checkout = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["customer", "subscription"],
    });

    const checkoutEmail = String(checkout.customer_details?.email || "").trim().toLowerCase();
    const userEmail = String(user.email || "").trim().toLowerCase();

    if (!checkoutEmail || !userEmail || checkoutEmail !== userEmail) {
      return NextResponse.json(
        { ok: false, error: "Email mismatch for checkout session." },
        { status: 403 }
      );
    }

    const name = (user.name || "").trim();
    const safeName = name ? escapeHtml(name) : "there";

    const planLabel = tier === "2" ? "Tier 2 — Unlimited" : "Tier 1 — Pro";
    const priceLabel = tier === "2" ? "$15.99/mo" : "$3.99/mo";

    const subject = `TaxAiPro subscription activated: ${planLabel}`;
    const html = `
      <div style="font-family:Arial, sans-serif; line-height:1.5; color:#111;">
        <h2 style="margin:0 0 10px;">Subscription activated ✅</h2>
        <p style="margin:0 0 10px;">Hi ${safeName},</p>
        <p style="margin:0 0 10px;">
          Thanks for subscribing to <b>${planLabel}</b> (${priceLabel}).
        </p>
        <p style="margin:0 0 10px;">
          Your higher daily run limit is now active on this account.
        </p>
        <p style="margin:16px 0 0;">
          — TaxAiPro Team<br/>
          <span style="color:#666; font-size:12px;">(Not legal or tax advice)</span>
        </p>
      </div>
    `;

    const text =
      `Subscription activated ✅\n\n` +
      `Hi ${name || "there"},\n\n` +
      `Thanks for subscribing to ${planLabel} (${priceLabel}). Your higher daily run limit is now active.\n\n` +
      `— TaxAiPro Team (Not legal or tax advice)`;

    await sendEmail({ to: userEmail, subject, html, text });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const msg = err?.message || "Unknown error";
    if (msg === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
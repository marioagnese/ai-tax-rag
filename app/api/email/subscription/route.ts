// app/api/email/subscription/route.ts
import { NextResponse } from "next/server";
import { requireSessionUser } from "../../../../src/lib/auth/session";
import { getTierForEmail } from "../../../../src/lib/billing/tier";
import { sendEmail } from "../../../../src/lib/email/sendgrid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tierName(t: "0" | "1" | "2") {
  if (t === "2") return "Tier 2 (Unlimited)";
  if (t === "1") return "Tier 1 (Pro)";
  return "Tier 0 (Free)";
}

export async function POST() {
  try {
    const user = await requireSessionUser();

    const email = (user.email || "").trim();
    if (!email) {
      return NextResponse.json({ ok: false, error: "Missing user email." }, { status: 400 });
    }

    const { tier } = await getTierForEmail(email);

    // Only send if actually paid
    if (tier !== "1" && tier !== "2") {
      return NextResponse.json(
        { ok: false, error: "No active paid subscription found for this user." },
        { status: 400 }
      );
    }

    const subject = "Thanks for upgrading your TaxAiPro plan";
    const html = `
      <div style="font-family:Arial, sans-serif; line-height:1.5; color:#111;">
        <h2 style="margin:0 0 10px;">Thank you for upgrading ✅</h2>
        <p style="margin:0 0 10px;">
          Your account is now on <b>${tierName(tier)}</b>.
        </p>
        <p style="margin:0 0 10px;">
          You can immediately use the higher daily run limits inside Crosscheck.
        </p>
        <p style="margin:16px 0 0;">
          — TaxAiPro Team<br/>
          <span style="color:#666; font-size:12px;">(Not legal or tax advice)</span>
        </p>
      </div>
    `;

    const text =
      `Thank you for upgrading!\n\n` +
      `Your account is now on ${tierName(tier)}.\n` +
      `You can immediately use the updated run limits.\n\n` +
      `— TaxAiPro Team (Not legal or tax advice)`;

    await sendEmail({ to: email, subject, html, text });

    return NextResponse.json({ ok: true, tier });
  } catch (err: any) {
    const msg = err?.message || "Unknown error";
    if (msg === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
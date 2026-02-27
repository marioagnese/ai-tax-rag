// app/api/email/welcome/route.ts
import { NextResponse } from "next/server";
import { requireSessionUser } from "../../../../src/lib/auth/session";
import { sendEmail } from "../../../../src/lib/email/sendgrid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function POST() {
  try {
    const user = await requireSessionUser();

    const email = (user.email || "").trim();
    if (!email) {
      return NextResponse.json({ ok: false, error: "Missing user email." }, { status: 400 });
    }

    const name = (user.name || "").trim();
    const safeName = name ? escapeHtml(name) : "there";

    const subject = "Welcome to TaxAiPro";
    const html = `
      <div style="font-family:Arial, sans-serif; line-height:1.5; color:#111;">
        <h2 style="margin:0 0 10px;">Welcome to TaxAiPro, ${safeName} 👋</h2>
        <p style="margin:0 0 10px;">
          TaxAiPro helps you quickly triage tax questions using a conservative, multi-model approach.
          You choose a jurisdiction, add facts, and run a validation to get a structured draft answer
          with assumptions, caveats, and missing facts to confirm.
        </p>
        <p style="margin:0 0 10px;">
          Tip: Run once → review “Missing facts” → add details → re-run for higher confidence.
        </p>
        <p style="margin:0 0 10px;">
          We’re still expanding documentation. Soon you’ll have a “How it works” page with examples.
        </p>
        <p style="margin:16px 0 0;">
          — TaxAiPro Team<br/>
          <span style="color:#666; font-size:12px;">(Not legal or tax advice)</span>
        </p>
      </div>
    `;

    const text =
      `Welcome to TaxAiPro, ${name || "there"}!\n\n` +
      `TaxAiPro helps you triage tax questions with a conservative, multi-model approach.\n` +
      `Pick a jurisdiction, add facts, run validation, and refine using missing facts.\n\n` +
      `— TaxAiPro Team (Not legal or tax advice)`;

    await sendEmail({ to: email, subject, html, text });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const msg = err?.message || "Unknown error";
    if (msg === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
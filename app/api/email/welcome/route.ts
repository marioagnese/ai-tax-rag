// app/api/email/welcome/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { requireSessionUser } from "../../../../src/lib/auth/session";
import { sendEmail } from "../../../../src/email/sendgrid";

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

/**
 * Protection model:
 * - If TAXAIPRO_INTERNAL_TOKEN is set, require header x-taxaipro-internal to match (for server->server calls from login).
 * - Otherwise, require an authenticated session user.
 */
async function authorize(req: NextRequest) {
  const internal = (process.env.TAXAIPRO_INTERNAL_TOKEN || "").trim();
  if (internal) {
    const got = (req.headers.get("x-taxaipro-internal") || "").trim();
    if (got && got === internal) return { ok: true as const };
    return { ok: false as const, status: 401, error: "Unauthorized (missing internal token)" };
  }

  // fallback: require session auth if no internal token configured
  try {
    await requireSessionUser();
    return { ok: true as const };
  } catch {
    return { ok: false as const, status: 401, error: "Unauthorized" };
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authorize(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = (await req.json().catch(() => ({}))) as any;

    const email = String(body?.email || "").trim();
    if (!email) {
      return NextResponse.json({ ok: false, error: "Missing email." }, { status: 400 });
    }

    const nameRaw = String(body?.name || "").trim();
    const safeName = nameRaw ? escapeHtml(nameRaw) : "there";

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
        <p style="margin:16px 0 0;">
          — TaxAiPro Team<br/>
          <span style="color:#666; font-size:12px;">(Not legal or tax advice)</span>
        </p>
      </div>
    `;

    const text =
      `Welcome to TaxAiPro, ${nameRaw || "there"}!\n\n` +
      `TaxAiPro helps you triage tax questions with a conservative, multi-model approach.\n` +
      `Pick a jurisdiction, add facts, run validation, and refine using missing facts.\n\n` +
      `— TaxAiPro Team (Not legal or tax advice)`;

    await sendEmail({ to: email, subject, html, text });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const msg = err?.message || "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
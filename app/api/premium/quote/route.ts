import { NextResponse } from "next/server";
import sgMail from "@sendgrid/mail";

export const runtime = "nodejs";

type QuoteThreadMsg = { role: "user" | "assistant"; text: string; createdAt?: number };

type QuotePayload = {
  name: string;
  email: string;
  jurisdiction: string;
  category: string;
  urgency?: "standard" | "rush";
  deliverable?: "memo" | "email" | "formal_opinion";
  summary: string;
  facts: string;
  thread?: QuoteThreadMsg[];
  consent_quote_only?: boolean;
  consent_no_acr?: boolean;
  consent_no_sensitive?: boolean;
};

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function safeStr(x: unknown) {
  return String(x ?? "").trim();
}

function clamp(s: string, n: number) {
  const t = s.trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

function formatThread(thread?: QuoteThreadMsg[]) {
  if (!Array.isArray(thread) || thread.length === 0) return "—";
  return thread
    .slice(-30)
    .map((m) => {
      const role = m?.role === "assistant" ? "assistant" : "user";
      const text = clamp(safeStr(m?.text), 800);
      const ts = m?.createdAt ? new Date(m.createdAt).toISOString() : "";
      return `[${role}${ts ? " " + ts : ""}] ${text}`;
    })
    .join("\n\n");
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    const body = (await req.json().catch(() => null)) as QuotePayload | null;

    const name = safeStr(body?.name);
    const email = safeStr(body?.email);
    const jurisdiction = safeStr(body?.jurisdiction);
    const category = safeStr(body?.category);
    const summary = safeStr(body?.summary);
    const facts = safeStr(body?.facts);

    if (!name || !email || !jurisdiction || !category || !summary || !facts) {
      return NextResponse.json({ ok: false, error: "Missing required fields." }, { status: 400 });
    }

    // Enforce consents (matches UI)
    if (!body?.consent_quote_only || !body?.consent_no_acr || !body?.consent_no_sensitive) {
      return NextResponse.json({ ok: false, error: "Required consents not accepted." }, { status: 400 });
    }

    const SENDGRID_API_KEY = requireEnv("SENDGRID_API_KEY");
    const FROM_EMAIL = requireEnv("SENDGRID_FROM"); // set to contact@taxaipro.com
    const QUOTE_NOTIFY_EMAIL = requireEnv("QUOTE_NOTIFY_EMAIL"); // your inbox

    sgMail.setApiKey(SENDGRID_API_KEY);

    const urgency = body?.urgency || "standard";
    const deliverable = body?.deliverable || "memo";

    const adminSubject = `TaxAiPro Quote Request (${jurisdiction}) — ${name}`;
    const adminText = [
      `New Formal Opinion Quote Request`,
      ``,
      `Request ID: ${requestId}`,
      `Name: ${name}`,
      `Email: ${email}`,
      `Jurisdiction: ${jurisdiction}`,
      `Category: ${category}`,
      `Urgency: ${urgency}`,
      `Deliverable: ${deliverable}`,
      ``,
      `Summary:`,
      summary,
      ``,
      `Facts:`,
      facts,
      ``,
      `Recent Crosscheck thread (last 30 msgs):`,
      formatThread(body?.thread),
      ``,
      `—`,
      `TaxAiPro`,
    ].join("\n");

    const userSubject = "We received your TaxAiPro quote request";
    const userText = [
      `Hi ${name},`,
      ``,
      `We received your request and will follow up with a scoped quote + next steps.`,
      ``,
      `Request ID: ${requestId}`,
      `Jurisdiction: ${jurisdiction}`,
      `Category: ${category}`,
      `Urgency: ${urgency}`,
      `Deliverable: ${deliverable}`,
      ``,
      `Summary (as received):`,
      summary,
      ``,
      `—`,
      `TaxAiPro (contact@taxaipro.com)`,
      `Not legal or tax advice.`,
    ].join("\n");

    // 1) Admin notification (reply-to user so you can just hit Reply)
    const adminResp = await sgMail.send({
      to: QUOTE_NOTIFY_EMAIL,
      from: FROM_EMAIL,
      subject: adminSubject,
      text: adminText,
      replyTo: email,
    });

    // 2) User confirmation
    const userResp = await sgMail.send({
      to: email,
      from: FROM_EMAIL,
      subject: userSubject,
      text: userText,
    });

    console.log("[premium/quote] sent", {
      requestId,
      adminStatus: adminResp?.[0]?.statusCode,
      userStatus: userResp?.[0]?.statusCode,
    });

    return NextResponse.json({ ok: true, requestId, emailSent: true });
  } catch (e: any) {
    console.error("[premium/quote] error", { requestId, error: e?.message || e });
    return NextResponse.json({ ok: false, error: e?.message || "Server error", requestId }, { status: 500 });
  }
}
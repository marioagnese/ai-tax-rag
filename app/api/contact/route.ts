// app/api/contact/route.ts
import { NextResponse } from "next/server";
import sgMail from "@sendgrid/mail";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) return jsonError("Missing SENDGRID_API_KEY", 500);

    // IMPORTANT: this must be a VERIFIED SENDER in SendGrid (Single Sender or Domain Auth)
    const fromEmail = process.env.SENDGRID_FROM_EMAIL || "contact@taxaipro.com";
    const toEmail = process.env.CONTACT_TO_EMAIL || "contact@taxaipro.com";

    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body");

    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim();
    const subject = String(body.subject || "").trim();
    const message = String(body.message || "").trim();
    const topic = String(body.topic || "General").trim();

    // Honeypot (optional): if filled, silently accept (blocks bots)
    const hp = String(body.company || "").trim();
    if (hp) return NextResponse.json({ ok: true });

    if (!name) return jsonError("Name is required");
    if (!email || !isValidEmail(email)) return jsonError("Valid email is required");
    if (!subject) return jsonError("Subject is required");
    if (!message) return jsonError("Message is required");
    if (message.length > 8000) return jsonError("Message too long (max 8000 chars)");

    sgMail.setApiKey(apiKey);

    const text = [
      `New TaxAiPro contact form message`,
      ``,
      `Topic: ${topic}`,
      `Name: ${name}`,
      `Email: ${email}`,
      `Subject: ${subject}`,
      ``,
      `Message:`,
      message,
      ``,
      `---`,
      `Sent from: ${new Date().toISOString()}`,
    ].join("\n");

    await sgMail.send({
      to: toEmail,
      from: fromEmail,
      replyTo: email, // so you can reply directly to the user
      subject: `[TaxAiPro] ${topic}: ${subject}`,
      text,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg =
      e?.response?.body?.errors?.[0]?.message ||
      e?.message ||
      "Failed to send message";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
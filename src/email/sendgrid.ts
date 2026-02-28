// src/email/sendgrid.ts
import "server-only";
import sgMail from "@sendgrid/mail";

type SendEmailArgs = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
};

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

let configured = false;

function ensureConfigured() {
  if (configured) return;
  const key = requireEnv("SENDGRID_API_KEY");
  sgMail.setApiKey(key);
  configured = true;
}

export async function sendEmail(args: SendEmailArgs) {
  ensureConfigured();

  const from = process.env.SENDGRID_FROM || process.env.SENDGRID_SENDER || "";
  if (!from) throw new Error("Missing env var: SENDGRID_FROM (or SENDGRID_SENDER)");

  const msg = {
    to: args.to,
    from,
    subject: args.subject,
    text: args.text || undefined,
    html: args.html || undefined,
  };

  await sgMail.send(msg as any);
}
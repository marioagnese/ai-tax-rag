// src/lib/email/sendgrid.ts
import "server-only";
import sgMail from "@sendgrid/mail";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function fromEmail() {
  return process.env.SENDGRID_FROM || "contact@taxaipro.com";
}

let configured = false;
function ensureConfigured() {
  if (configured) return;
  const key = requireEnv("SENDGRID_API_KEY");
  sgMail.setApiKey(key);
  configured = true;
}

export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}) {
  ensureConfigured();

  const to = (args.to || "").trim();
  if (!to) throw new Error("Missing 'to' email");

  await sgMail.send({
    to,
    from: fromEmail(),
    subject: args.subject,
    text: args.text,
    html: args.html,
  });
}

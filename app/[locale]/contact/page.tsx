// app/contact/page.tsx
"use client";

import React, { useState } from "react";

type Status =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "success" }
  | { state: "error"; message: string };

export default function ContactPage() {
  const [status, setStatus] = useState<Status>({ state: "idle" });

  const [topic, setTopic] = useState<"General" | "Human review" | "Affiliate">("General");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  // Honeypot (should stay empty)
  const [company, setCompany] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ state: "loading" });

    try {
      const r = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic,
          name,
          email,
          subject,
          message,
          company, // honeypot
        }),
      });

      const data = await r.json().catch(() => ({ ok: false, error: "Bad response" }));

      if (!r.ok || data?.ok === false) {
        setStatus({ state: "error", message: data?.error || `Request failed (${r.status})` });
        return;
      }

      setStatus({ state: "success" });
      setName("");
      setEmail("");
      setSubject("");
      setMessage("");
      setCompany("");
    } catch (err: any) {
      setStatus({ state: "error", message: err?.message || "Request failed" });
    }
  }

  return (
    <div className="min-h-screen bg-[#070A12] text-white">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="flex items-center gap-3">
          <img
            src="/taxaipro-logo.png"
            alt="TaxAiPro"
            className="h-12 w-12 rounded-xl border border-white/10 bg-white/5 object-contain"
          />
          <div>
            <div className="text-lg font-semibold text-white/90">Contact TaxAiPro</div>
            <div className="text-xs text-white/55">
              Human review requests, general inquiries, and affiliate inquiries go to{" "}
              <span className="text-white/85">contact@taxaipro.com</span>.
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-white/70">Topic</label>
              <select
                value={topic}
                onChange={(e) => setTopic(e.target.value as any)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-white/20"
              >
                <option value="General">General</option>
                <option value="Human review">Human review</option>
                <option value="Affiliate">Affiliate</option>
              </select>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="text-xs font-semibold text-white/70">Your name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-white/20"
                  placeholder="Mario"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-white/70">Your email</label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-white/20"
                  placeholder="you@company.com"
                  type="email"
                  required
                />
              </div>
            </div>

            {/* Honeypot (hidden) */}
            <div className="hidden">
              <label>Company</label>
              <input value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>

            <div>
              <label className="text-xs font-semibold text-white/70">Subject</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-white/20"
                placeholder="Short summary"
                required
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-white/70">Message</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="mt-2 min-h-[180px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-white/20"
                placeholder="Tell me what you need…"
                required
              />
            </div>

            {status.state === "error" ? (
              <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-100">
                {status.message}
              </div>
            ) : null}

            {status.state === "success" ? (
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                Sent — we’ll reply soon.
              </div>
            ) : null}

            <button
              type="submit"
              disabled={status.state === "loading"}
              className="h-10 w-full rounded-xl bg-white text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60"
            >
              {status.state === "loading" ? "Sending…" : "Send message"}
            </button>

            <div className="text-[11px] text-white/45">
              Prefer email? Write directly to <span className="text-white/75">contact@taxaipro.com</span>.
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

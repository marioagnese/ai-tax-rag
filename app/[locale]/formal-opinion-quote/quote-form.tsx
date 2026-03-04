"use client";

import React, { useMemo, useState } from "react";

type QuoteThreadMsg = { role: "user" | "assistant"; text: string; createdAt?: number };

type QuotePayload = {
  name: string;
  email: string;
  jurisdiction: string;
  category: string;
  urgency: "standard" | "rush";
  deliverable: "memo" | "email" | "formal_opinion";
  summary: string;
  facts: string;
  thread?: QuoteThreadMsg[];
  consent_quote_only: boolean;
  consent_no_acr: boolean;
  consent_no_sensitive: boolean;
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-white/10 bg-white/[0.035] backdrop-blur-sm", className)}>
      {children}
    </div>
  );
}

function readJsonLS<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizeThread(raw: any[] | null): QuoteThreadMsg[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  const cleaned: QuoteThreadMsg[] = [];
  for (const m of raw) {
    const text = String((m as any)?.text ?? "").trim();
    if (!text) continue;

    const role: "user" | "assistant" = (m as any)?.role === "assistant" ? "assistant" : "user";
    const createdAtNum = Number((m as any)?.createdAt);
    const createdAt = Number.isFinite(createdAtNum) ? createdAtNum : undefined;

    cleaned.push({ role, text, createdAt });
  }

  if (!cleaned.length) return undefined;
  return cleaned.slice(-30);
}

export default function QuoteForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const [jurisdiction, setJurisdiction] = useState("Panama");
  const [category, setCategory] = useState("Cross-border tax (general)");

  const [urgency, setUrgency] = useState<QuotePayload["urgency"]>("standard");
  const [deliverable, setDeliverable] = useState<QuotePayload["deliverable"]>("memo");

  const [summary, setSummary] = useState("");
  const [facts, setFacts] = useState("");

  const [includeThread, setIncludeThread] = useState(true);

  const [consentQuoteOnly, setConsentQuoteOnly] = useState(false);
  const [consentNoACR, setConsentNoACR] = useState(false);
  const [consentNoSensitive, setConsentNoSensitive] = useState(false);

  const [loading, setLoading] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    if (!name.trim() || !email.trim()) return false;
    if (!jurisdiction.trim() || !category.trim()) return false;
    if (!summary.trim() || summary.trim().length < 20) return false;
    if (!facts.trim() || facts.trim().length < 20) return false;
    if (!consentQuoteOnly || !consentNoACR || !consentNoSensitive) return false;
    return true;
  }, [name, email, jurisdiction, category, summary, facts, consentQuoteOnly, consentNoACR, consentNoSensitive]);

  async function submit() {
    setError(null);
    setOk(false);

    const threadRaw = includeThread ? readJsonLS<any[]>("taxaipro_active_thread_v1") : null;
    const thread = normalizeThread(threadRaw);

    const payload: QuotePayload = {
      name: name.trim(),
      email: email.trim(),
      jurisdiction: jurisdiction.trim(),
      category: category.trim(),
      urgency,
      deliverable,
      summary: summary.trim(),
      facts: facts.trim(),
      thread,
      consent_quote_only: consentQuoteOnly,
      consent_no_acr: consentNoACR,
      consent_no_sensitive: consentNoSensitive,
    };

    setLoading(true);
    try {
      const r = await fetch("/api/premium/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = (await r.json().catch(() => null)) as any;

      if (!r.ok || !j?.ok) {
        setError(j?.error || `Request failed (${r.status})`);
        return;
      }

      setOk(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) {
      setError(e?.message || "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="grid grid-cols-1 gap-4">
        {ok ? (
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-100">
            <div>Submitted. We’ll email you with a quote + next steps.</div>
            <div className="mt-3">
              <a
                href="/crosscheck"
                className="inline-flex items-center rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/85 hover:bg-white/10"
              >
                ← Back to Crosscheck
              </a>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-100">{error}</div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div className="text-xs font-semibold text-white/80">Name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/20"
              placeholder="Your name"
            />
          </div>

          <div>
            <div className="text-xs font-semibold text-white/80">Email</div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/20"
              placeholder="you@company.com"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div className="text-xs font-semibold text-white/80">Jurisdiction</div>
            <input
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/20"
              placeholder="e.g., Panama, US, Brazil"
            />
          </div>

          <div>
            <div className="text-xs font-semibold text-white/80">Category</div>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/20"
              placeholder="e.g., Withholding tax, VAT, PE risk"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div className="text-xs font-semibold text-white/80">Urgency</div>
            <select
              value={urgency}
              onChange={(e) => setUrgency(e.target.value as any)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-white/20"
            >
              <option value="standard">Standard</option>
              <option value="rush">Rush</option>
            </select>
          </div>

          <div>
            <div className="text-xs font-semibold text-white/80">Deliverable</div>
            <select
              value={deliverable}
              onChange={(e) => setDeliverable(e.target.value as any)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-white/20"
            >
              <option value="memo">Memo</option>
              <option value="email">Email</option>
              <option value="formal_opinion">Formal opinion</option>
            </select>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-white/80">Summary (what you need)</div>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="mt-2 min-h-[110px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/20"
            placeholder="Describe the question and what decision you need to make (min ~20 chars)."
          />
        </div>

        <div>
          <div className="text-xs font-semibold text-white/80">Facts (bullets preferred)</div>
          <textarea
            value={facts}
            onChange={(e) => setFacts(e.target.value)}
            className="mt-2 min-h-[160px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/20"
            placeholder="Entity type, countries, flow, amounts, dates, where services performed, contract terms, etc. (min ~20 chars)."
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-white/70">
          <input
            type="checkbox"
            checked={includeThread}
            onChange={(e) => setIncludeThread(e.target.checked)}
            className="h-4 w-4"
          />
          Include my recent Crosscheck thread (last 30 messages)
        </label>

        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="text-xs font-semibold text-white/80">Consents (required)</div>

          <label className="mt-2 flex items-start gap-2 text-sm text-white/70">
            <input
              type="checkbox"
              checked={consentQuoteOnly}
              onChange={(e) => setConsentQuoteOnly(e.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <span>I understand this is a quote request only (not legal advice).</span>
          </label>

          <label className="mt-2 flex items-start gap-2 text-sm text-white/70">
            <input
              type="checkbox"
              checked={consentNoACR}
              onChange={(e) => setConsentNoACR(e.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <span>I will not rely on this as a tax return position or ACR filing.</span>
          </label>

          <label className="mt-2 flex items-start gap-2 text-sm text-white/70">
            <input
              type="checkbox"
              checked={consentNoSensitive}
              onChange={(e) => setConsentNoSensitive(e.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <span>I will not submit sensitive personal data (SSNs, passwords, etc.).</span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={submit}
            disabled={!canSubmit || loading}
            className="h-10 rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-50"
          >
            {loading ? "Submitting…" : "Request quote"}
          </button>
        </div>
      </div>
    </Card>
  );
}
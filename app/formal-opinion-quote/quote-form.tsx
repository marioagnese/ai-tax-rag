"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type QuotePayload = {
  name: string;
  email: string;
  jurisdiction: string;
  category: string;
  urgency: "standard" | "rush";
  deliverable: "memo" | "signed_opinion" | "client_letter" | "other";
  summary: string;
  facts: string;
  thread?: Array<{ role: "user" | "assistant"; text: string; createdAt?: number }>;
  consent_quote_only: boolean;
  consent_no_acr: boolean;
  consent_no_sensitive: boolean;
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-semibold text-white/70">{children}</div>;
}

function Help({ children }: { children: React.ReactNode }) {
  return <div className="mt-1 text-[11px] text-white/45">{children}</div>;
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

export default function QuoteForm() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const [jurisdiction, setJurisdiction] = useState("United States");
  const [category, setCategory] = useState("International tax");
  const [urgency, setUrgency] = useState<"standard" | "rush">("standard");
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

  // Prefill from autosaved thread if present
  useEffect(() => {
    const thread = readJsonLS<any[]>("taxaipro_active_thread_v1");
    if (!thread?.length) return;

    // Try to infer a short summary from the most recent user message
    const lastUser = [...thread].reverse().find((m) => m?.role === "user" && String(m?.text ?? "").trim());
    if (lastUser && !summary.trim()) {
      setSummary(String(lastUser.text).trim().slice(0, 600));
    }

    // Add a “facts-like” starter: list the last few user turns
    const userTurns = thread
      .filter((m) => m?.role === "user")
      .map((m) => String(m?.text ?? "").trim())
      .filter(Boolean)
      .slice(-6);

    if (userTurns.length && !facts.trim()) {
      const bullets = userTurns.map((t) => `• ${t.replace(/\s+/g, " ")}`).join("\n");
      setFacts(
        [
          "Context (from your TaxAiPro thread):",
          bullets,
          "",
          "Additional facts / documents to consider:",
          "",
        ].join("\n")
      );
    }
  }, [summary, facts]);

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

      type ThreadItem = { role: "user" | "assistant"; text: string; createdAt?: number };

      const thread: QuotePayload["thread"] =
        Array.isArray(threadRaw) && threadRaw.length
          ? (threadRaw as any[])
              .map((m: any): ThreadItem | null => {
                const text = String(m?.text ?? "").trim();
                if (!text) return null;

                const role: "user" | "assistant" = m?.role === "assistant" ? "assistant" : "user";
                const createdAtNum = Number(m?.createdAt);

                return { role, text, createdAt: Number.isFinite(createdAtNum) ? createdAtNum : undefined };
              })
              .filter((x): x is ThreadItem => x !== null)
              .slice(-30)
          : undefined;

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
      // Optional: clear inputs but keep summary/facts for edits
      // setName(""); setEmail("");
    } catch (e: any) {
      setError(e?.message || "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  if (ok) {
    return (
      <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-6">
        <div className="text-sm font-semibold text-emerald-100">Request received</div>
        <div className="mt-2 text-sm text-emerald-100/90 leading-relaxed">
          We received your request for a formal opinion quote. You should receive a confirmation email shortly.
          <br />
          <br />
          Next steps: we’ll review the facts and respond via official email with scope questions and a quote.
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => router.push("/crosscheck")}
            className="rounded-xl bg-white px-4 py-2 text-xs font-semibold text-black hover:bg-white/90"
          >
            Back to Crosscheck
          </button>
          <button
            type="button"
            onClick={() => setOk(false)}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs text-white/85 hover:bg-white/10"
          >
            Submit another request
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-6 backdrop-blur-sm">
      <div className="grid grid-cols-1 gap-4">
        <div>
          <div className="text-sm font-semibold text-white/90">Intake</div>
          <div className="mt-1 text-[11px] text-white/55">
            Provide enough detail to scope the engagement. If details are missing, we’ll follow up by email.
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <FieldLabel>Your name</FieldLabel>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-white/20"
              placeholder="Full name"
            />
          </div>

          <div>
            <FieldLabel>Email</FieldLabel>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-white/20"
              placeholder="you@company.com"
              inputMode="email"
            />
            <Help>This is where we’ll send the quote and follow-ups.</Help>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <FieldLabel>Jurisdiction</FieldLabel>
            <input
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-white/20"
              placeholder="e.g., United States (Federal) + Texas"
            />
          </div>

          <div>
            <FieldLabel>Category</FieldLabel>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black px-3 py-2.5 text-sm outline-none focus:border-white/20"
            >
              <option>International tax</option>
              <option>U.S. federal income tax</option>
              <option>State & local tax</option>
              <option>VAT / GST</option>
              <option>Transfer pricing</option>
              <option>Withholding tax</option>
              <option>Corporate reorganizations / M&amp;A</option>
              <option>Indirect taxes / customs</option>
              <option>Other</option>
            </select>
          </div>

          <div>
            <FieldLabel>Urgency</FieldLabel>
            <select
              value={urgency}
              onChange={(e) => setUrgency(e.target.value as any)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black px-3 py-2.5 text-sm outline-none focus:border-white/20"
            >
              <option value="standard">Standard</option>
              <option value="rush">Rush</option>
            </select>
            <Help>Rush requests may affect pricing and availability.</Help>
          </div>
        </div>

        <div>
          <FieldLabel>Deliverable requested</FieldLabel>
          <select
            value={deliverable}
            onChange={(e) => setDeliverable(e.target.value as any)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-black px-3 py-2.5 text-sm outline-none focus:border-white/20"
          >
            <option value="memo">Internal tax memo</option>
            <option value="signed_opinion">Signed professional opinion (where appropriate)</option>
            <option value="client_letter">Client-facing letter</option>
            <option value="other">Other / specify in summary</option>
          </select>
        </div>

        <div>
          <FieldLabel>Issue summary (required)</FieldLabel>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="mt-2 min-h-[110px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-white/20"
            placeholder="In 3–8 sentences: what decision you need to make, and what you need the memo/opinion to address."
          />
          <Help>Write as if you are briefing a senior reviewer. Include amounts/thresholds if relevant.</Help>
        </div>

        <div>
          <FieldLabel>Facts (required)</FieldLabel>
          <textarea
            value={facts}
            onChange={(e) => setFacts(e.target.value)}
            className="mt-2 min-h-[160px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-white/20"
            placeholder={[
              "Use bullets if possible:",
              "• Entities and residency",
              "• Transaction steps and timing",
              "• Where services are performed / where title passes",
              "• Thresholds (PE, VAT registration, WHT, etc.)",
              "• Any relevant contracts or documents (summarize if not attaching)",
            ].join("\n")}
          />
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-white/80">Include your recent TaxAiPro thread</div>
              <div className="mt-1 text-[11px] text-white/55">
                If enabled, we attach your last ~30 thread messages to the intake email for context.
              </div>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-white/75">
              <input
                type="checkbox"
                checked={includeThread}
                onChange={(e) => setIncludeThread(e.target.checked)}
                className="h-4 w-4"
              />
              Include thread
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="text-xs font-semibold text-white/80">Confirmations</div>

          <label className="mt-3 flex items-start gap-2 text-xs text-white/70">
            <input
              type="checkbox"
              checked={consentQuoteOnly}
              onChange={(e) => setConsentQuoteOnly(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>I understand this submission is a request for quote only (not advice and not an engagement).</span>
          </label>

          <label className="mt-2 flex items-start gap-2 text-xs text-white/70">
            <input
              type="checkbox"
              checked={consentNoACR}
              onChange={(e) => setConsentNoACR(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>I understand no attorney-client relationship is created by submitting this form.</span>
          </label>

          <label className="mt-2 flex items-start gap-2 text-xs text-white/70">
            <input
              type="checkbox"
              checked={consentNoSensitive}
              onChange={(e) => setConsentNoSensitive(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>I will not include sensitive personal data (SSNs, account numbers, credentials, secrets).</span>
          </label>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-100">{error}</div>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-[11px] text-white/45">
            Typical response time depends on complexity. We’ll follow up via email if clarifications are needed.
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit || loading}
            className={cn(
              "h-10 rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-white/90",
              (!canSubmit || loading) && "opacity-50 cursor-not-allowed"
            )}
          >
            {loading ? "Submitting…" : "Request quote"}
          </button>
        </div>
      </div>
    </div>
  );
}
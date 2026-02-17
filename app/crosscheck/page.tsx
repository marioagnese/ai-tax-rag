"use client";

import React, { useEffect, useMemo, useState } from "react";

type CrosscheckResponse = {
  ok: boolean;
  meta?: {
    attempted?: Array<{ provider: string; model: string }>;
    succeeded?: Array<{ provider: string; model: string }>;
    failed?: Array<{ provider: string; model: string }>;
    runtime_ms?: number;
  };
  consensus?: {
    answer?: string;
    caveats?: string[];
    followups?: string[];
    disagreements?: string[];
    confidence?: "low" | "medium" | "high";
  };
  providers?: Array<{
    provider: string;
    model: string;
    status: "ok" | "error" | "timeout";
    ms: number;
    text?: string;
    error?: string;
  }>;
  error?: string;
};

type OutputStyle = "answer" | "memo" | "email";

type SavedRun = {
  id: string;
  createdAt: number;
  title: string;
  jurisdiction?: string;
  facts?: string;
  answerStyle?: string;
  question: string;
  answer?: string;
  caveats?: string[];
  followups?: string[];
  disagreements?: string[];
  confidence?: "low" | "medium" | "high";
};

const LS_KEY = "taxaipro_runs_v1";

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/80">
      {children}
    </span>
  );
}

function SectionTitle({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="text-xs font-semibold tracking-wide text-white/60 uppercase">
        {children}
      </div>
      {hint ? <div className="text-[11px] text-white/40">{hint}</div> : null}
    </div>
  );
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.03] ${className}`}
    >
      {children}
    </div>
  );
}

function formatMemo(args: {
  jurisdiction?: string;
  facts?: string;
  question: string;
  answer?: string;
  caveats?: string[];
  followups?: string[];
  disagreements?: string[];
  confidence?: string;
}) {
  const {
    jurisdiction,
    facts,
    question,
    answer,
    caveats = [],
    followups = [],
    disagreements = [],
    confidence,
  } = args;

  const lines: string[] = [];
  lines.push(`MEMO — TaxAiPro (Draft)`);
  lines.push(`Date: ${new Date().toLocaleString()}`);
  if (jurisdiction) lines.push(`Jurisdiction: ${jurisdiction}`);
  if (confidence) lines.push(`Confidence: ${confidence}`);
  lines.push("");
  lines.push("Question:");
  lines.push(question.trim());
  lines.push("");

  if (facts?.trim()) {
    lines.push("Key facts provided:");
    lines.push(facts.trim());
    lines.push("");
  }

  lines.push("Preliminary answer (conservative):");
  lines.push((answer || "—").trim());
  lines.push("");

  if (caveats.length) {
    lines.push("Caveats / limitations:");
    caveats.forEach((c) => lines.push(`- ${c}`));
    lines.push("");
  }

  if (followups.length) {
    lines.push("Missing facts / follow-ups needed:");
    followups.forEach((f) => lines.push(`- ${f}`));
    lines.push("");
  }

  if (disagreements.length) {
    lines.push("Noted disagreements across models:");
    disagreements.forEach((d) => lines.push(`- ${d}`));
    lines.push("");
  }

  lines.push(
    "Not legal or tax advice. For decisions, validate with primary sources and/or counsel."
  );
  return lines.join("\n");
}

function formatEmail(args: {
  jurisdiction?: string;
  question: string;
  answer?: string;
  caveats?: string[];
  followups?: string[];
}) {
  const { jurisdiction, question, answer, caveats = [], followups = [] } = args;

  const lines: string[] = [];
  lines.push(
    `Subject: Tax question follow-up${
      jurisdiction ? ` (${jurisdiction})` : ""
    }`
  );
  lines.push("");
  lines.push("Hi [Name],");
  lines.push("");
  lines.push("Here’s a concise summary based on the facts provided so far:");
  lines.push("");
  lines.push(`Question: ${question.trim()}`);
  lines.push("");
  lines.push("Answer (preliminary):");
  lines.push((answer || "—").trim());
  lines.push("");

  if (caveats.length) {
    lines.push("Key caveats:");
    caveats.forEach((c) => lines.push(`• ${c}`));
    lines.push("");
  }

  if (followups.length) {
    lines.push("To confirm the conclusion, I still need:");
    followups.forEach((f) => lines.push(`• ${f}`));
    lines.push("");
  }

  lines.push("Best,");
  lines.push("[Your name]");
  lines.push("");
  lines.push("—");
  lines.push("Draft generated with TaxAiPro (not legal or tax advice).");
  return lines.join("\n");
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function safeParseRuns(): SavedRun[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(Boolean)
      .map((x: any) => ({
        id: String(x.id || crypto.randomUUID()),
        createdAt: Number(x.createdAt || Date.now()),
        title: String(x.title || "Untitled"),
        jurisdiction: x.jurisdiction ? String(x.jurisdiction) : undefined,
        facts: x.facts ? String(x.facts) : undefined,
        answerStyle: x.answerStyle ? String(x.answerStyle) : undefined,
        question: String(x.question || ""),
        answer: x.answer ? String(x.answer) : undefined,
        caveats: Array.isArray(x.caveats) ? x.caveats.map(String) : [],
        followups: Array.isArray(x.followups) ? x.followups.map(String) : [],
        disagreements: Array.isArray(x.disagreements)
          ? x.disagreements.map(String)
          : [],
        confidence:
          x.confidence === "low" || x.confidence === "medium" || x.confidence === "high"
            ? x.confidence
            : undefined,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

function persistRuns(runs: SavedRun[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(runs.slice(0, 50)));
}

export default function CrosscheckPage() {
  const [jurisdiction, setJurisdiction] = useState("Panama");
  const [facts, setFacts] = useState("");
  const [answerStyle, setAnswerStyle] = useState(
    [
      "Act like a senior tax specialist.",
      "Be conservative; avoid overclaiming.",
      "Start with a bottom-line first.",
      "List assumptions, missing facts, and caveats.",
      "If multiple outcomes exist, show decision tree / thresholds.",
    ].join("\n")
  );
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<CrosscheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [outputStyle, setOutputStyle] = useState<OutputStyle>("answer");

  const [history, setHistory] = useState<SavedRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Load history once (client-only)
  useEffect(() => {
    setHistory(safeParseRuns());
  }, []);

  const succeeded = resp?.meta?.succeeded ?? [];
  const failed = resp?.meta?.failed ?? [];
  const runtimeMs = resp?.meta?.runtime_ms ?? null;

  const providerBadges = useMemo(() => {
    const ok = succeeded.map((x) => `${x.provider}:${x.model}`);
    const bad = failed.map((x) => `${x.provider}:${x.model}`);
    return { ok, bad };
  }, [succeeded, failed]);

  const displayText = useMemo(() => {
    const base = {
      jurisdiction: jurisdiction.trim() || undefined,
      facts: facts.trim() || undefined,
      question: question.trim(),
      answer: resp?.consensus?.answer || "",
      caveats: resp?.consensus?.caveats || [],
      followups: resp?.consensus?.followups || [],
      disagreements: resp?.consensus?.disagreements || [],
      confidence: resp?.consensus?.confidence,
    };

    if (outputStyle === "memo") return formatMemo(base);
    if (outputStyle === "email") return formatEmail(base);
    return (resp?.consensus?.answer || "Your consensus answer will appear here.").trim();
  }, [outputStyle, resp, jurisdiction, facts, question]);

  const canSave = !!resp?.consensus?.answer?.trim();

  function loadRun(r: SavedRun) {
    setSelectedId(r.id);
    setJurisdiction(r.jurisdiction || "");
    setFacts(r.facts || "");
    setAnswerStyle(r.answerStyle || answerStyle);
    setQuestion(r.question || "");
    setResp({
      ok: true,
      consensus: {
        answer: r.answer,
        caveats: r.caveats || [],
        followups: r.followups || [],
        disagreements: r.disagreements || [],
        confidence: r.confidence,
      },
      meta: {
        runtime_ms: undefined,
        attempted: [],
        succeeded: [],
        failed: [],
      },
      providers: [],
    });
    setError(null);
  }

  function deleteRun(id: string) {
    const next = history.filter((h) => h.id !== id);
    setHistory(next);
    persistRuns(next);
    if (selectedId === id) setSelectedId(null);
  }

  function saveCurrentRun() {
    if (!canSave) return;

    const title = (question.trim().slice(0, 60) || "Untitled").replace(/\s+/g, " ");
    const now = Date.now();

    const run: SavedRun = {
      id: crypto.randomUUID(),
      createdAt: now,
      title,
      jurisdiction: jurisdiction.trim() || undefined,
      facts: facts.trim() || undefined,
      answerStyle: answerStyle.trim() || undefined,
      question: question.trim(),
      answer: resp?.consensus?.answer || "",
      caveats: resp?.consensus?.caveats || [],
      followups: resp?.consensus?.followups || [],
      disagreements: resp?.consensus?.disagreements || [],
      confidence: resp?.consensus?.confidence,
    };

    const next = [run, ...history].slice(0, 50);
    setHistory(next);
    persistRuns(next);
    setSelectedId(run.id);
  }

  async function run() {
    setError(null);
    setResp(null);

    const q = question.trim();
    if (!q) {
      setError("Type a question first.");
      return;
    }

    setLoading(true);
    try {
      const r = await fetch("/api/ui/crosscheck", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jurisdiction: jurisdiction.trim() || undefined,
          facts: facts.trim() || undefined,
          constraints: answerStyle.trim() || undefined,
          question: q,
        }),
      });

      const text = await r.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = { ok: false, error: text };
      }

      if (!r.ok || json?.ok === false) {
        setResp(json);
        setError(json?.error || `Request failed (${r.status})`);
      } else {
        setResp(json);
      }
    } catch (e: any) {
      setError(e?.message || "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, facts, answerStyle, jurisdiction]);

  const confidence = resp?.consensus?.confidence;

  return (
    <div className="min-h-screen text-white bg-[#070A12]">
      <div className="pointer-events-none fixed inset-0 opacity-70">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute bottom-[-180px] right-[-120px] h-[520px] w-[520px] rounded-full bg-white/5 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 py-6">
        {/* Top bar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            {/* Replace with your logo in /public, e.g. /taxaipro-logo.png */}
            <div className="h-10 w-10 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center font-bold">
              AI
            </div>
            <div>
              <div className="text-sm font-semibold">TaxAiPro</div>
              <div className="text-xs text-white/60">
                Multi-model validation + conservative synthesis (2–3 run method)
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Pill>⌘/Ctrl + Enter</Pill>
            {runtimeMs != null && <Pill>{runtimeMs}ms</Pill>}
            {confidence ? <Pill>Confidence: {confidence}</Pill> : null}
          </div>
        </div>

        {/* How to use */}
        <Card className="mt-4 p-4">
          <details>
            <summary className="cursor-pointer select-none text-sm font-semibold text-white/90">
              How to use (2–3 run method)
              <span className="ml-2 text-xs font-normal text-white/50">
                run → fill missing facts → re-run → export
              </span>
            </summary>

            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3 text-sm text-white/75">
              <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                <div className="text-xs font-semibold text-white/80">Run 1</div>
                <div className="mt-1">
                  Ask the question with minimal facts. Expect the result to include{" "}
                  <span className="text-white/90">Missing facts</span> and{" "}
                  <span className="text-white/90">Caveats</span>.
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                <div className="text-xs font-semibold text-white/80">Run 2</div>
                <div className="mt-1">
                  Paste the requested items into <span className="text-white/90">Facts</span> and re-run.
                  You’ll usually get a much tighter answer.
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                <div className="text-xs font-semibold text-white/80">Run 3 (optional)</div>
                <div className="mt-1">
                  If confidence is low or there are disagreements, add clarifying facts or constraints,
                  then export as <span className="text-white/90">Memo</span> or <span className="text-white/90">Email</span>.
                </div>
              </div>
            </div>
          </details>
        </Card>

        {/* Layout */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* History */}
          <Card className="lg:col-span-2 p-4">
            <SectionTitle hint="Saved on this device">Case history</SectionTitle>

            <div className="mt-3 text-xs text-white/50">
              This is local for now. Next step: tie to Firebase UID + Firestore.
            </div>

            <div className="mt-3 space-y-2">
              {history.length ? (
                history.map((h) => (
                  <div
                    key={h.id}
                    className={`rounded-xl border border-white/10 p-2 bg-black/30 ${
                      selectedId === h.id ? "ring-1 ring-white/20" : ""
                    }`}
                  >
                    <button
                      onClick={() => loadRun(h)}
                      className="w-full text-left"
                      title={h.title}
                    >
                      <div className="text-xs font-semibold text-white/85 line-clamp-2">
                        {h.title}
                      </div>
                      <div className="mt-1 text-[11px] text-white/45">
                        {new Date(h.createdAt).toLocaleDateString()} ·{" "}
                        {h.jurisdiction || "—"}
                      </div>
                    </button>

                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[11px] text-white/45">
                        {h.confidence ? `Conf: ${h.confidence}` : "—"}
                      </span>
                      <button
                        onClick={() => deleteRun(h.id)}
                        className="text-[11px] text-white/50 hover:text-white/80"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-white/50">
                  No saved runs yet.
                </div>
              )}
            </div>
          </Card>

          {/* Intake */}
          <Card className="lg:col-span-3 p-4">
            <SectionTitle hint="Context used by every run">Intake</SectionTitle>

            <label className="mt-3 block text-xs text-white/70">
              Jurisdiction
              <span className="ml-2 text-[11px] text-white/40">
                (country/state; add treaty context if relevant)
              </span>
            </label>
            <input
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/20"
              placeholder="e.g., Panama"
            />

            <label className="mt-3 block text-xs text-white/70">
              Facts
              <span className="ml-2 text-[11px] text-white/40">
                (paste bullets; after Run 1, paste “missing facts” here)
              </span>
            </label>
            <textarea
              value={facts}
              onChange={(e) => setFacts(e.target.value)}
              className="mt-1 min-h-[160px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/20"
              placeholder={[
                "• Entity type, residency, ownership",
                "• Transaction flow + timing + amounts",
                "• Where title passes / who performs services",
                "• Thresholds (PE, withholding, VAT registration, etc.)",
              ].join("\n")}
            />

            <label className="mt-3 block text-xs text-white/70">
              Answer style (global guidance)
              <span className="ml-2 text-[11px] text-white/40">
                (used as constraints; keep stable across runs)
              </span>
            </label>
            <textarea
              value={answerStyle}
              onChange={(e) => setAnswerStyle(e.target.value)}
              className="mt-1 min-h-[140px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/20"
              placeholder="Tone, format, conservative posture…"
            />
          </Card>

          {/* Ask */}
          <Card className="lg:col-span-4 p-4">
            <SectionTitle hint="Keep the question short; move details to Facts">
              Ask
            </SectionTitle>

            <div className="mt-3 rounded-2xl border border-white/10 bg-black/30 p-3">
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                className="min-h-[140px] w-full resize-none bg-transparent text-sm outline-none"
                placeholder="Ask your tax question here…"
              />

              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-white/50">
                  Tip: Run 1 is exploratory. Then paste “Missing facts” into Facts and re-run.
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={run}
                    disabled={loading}
                    className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                  >
                    {loading ? "Running…" : "Crosscheck"}
                  </button>

                  <button
                    onClick={saveCurrentRun}
                    disabled={!canSave}
                    className="rounded-xl border border-white/15 px-3 py-2 text-sm text-white/90 hover:bg-white/5 disabled:opacity-40 disabled:hover:bg-transparent"
                    title={canSave ? "Save this run" : "Run once first"}
                  >
                    Save run
                  </button>
                </div>
              </div>
            </div>

            {error && (
              <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
                {error}
              </div>
            )}

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
              <SectionTitle hint="Useful to debug outages / model failures">
                Models
              </SectionTitle>
              <div className="mt-2 flex flex-wrap gap-2">
                {providerBadges.ok.map((x) => (
                  <span
                    key={x}
                    className="rounded-full bg-emerald-500/15 border border-emerald-500/25 px-2.5 py-1 text-xs text-emerald-100"
                  >
                    ✓ {x}
                  </span>
                ))}
                {providerBadges.bad.map((x) => (
                  <span
                    key={x}
                    className="rounded-full bg-amber-500/15 border border-amber-500/25 px-2.5 py-1 text-xs text-amber-100"
                  >
                    ! {x}
                  </span>
                ))}
                {!resp && (
                  <span className="text-xs text-white/50">
                    Run once to see status.
                  </span>
                )}
              </div>
            </div>
          </Card>

          {/* Results */}
          <Card className="lg:col-span-3 p-4">
            <SectionTitle hint="Switch output style, then copy/download">
              Output
            </SectionTitle>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setOutputStyle("answer")}
                className={`rounded-full px-3 py-1 text-xs border ${
                  outputStyle === "answer"
                    ? "bg-white text-black border-white"
                    : "border-white/15 text-white/80 hover:bg-white/5"
                }`}
              >
                Answer
              </button>
              <button
                onClick={() => setOutputStyle("memo")}
                className={`rounded-full px-3 py-1 text-xs border ${
                  outputStyle === "memo"
                    ? "bg-white text-black border-white"
                    : "border-white/15 text-white/80 hover:bg-white/5"
                }`}
              >
                Memo
              </button>
              <button
                onClick={() => setOutputStyle("email")}
                className={`rounded-full px-3 py-1 text-xs border ${
                  outputStyle === "email"
                    ? "bg-white text-black border-white"
                    : "border-white/15 text-white/80 hover:bg-white/5"
                }`}
              >
                Email
              </button>

              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(displayText);
                    } catch {}
                  }}
                  className="rounded-xl border border-white/15 px-3 py-1.5 text-xs text-white/85 hover:bg-white/5"
                >
                  Copy
                </button>

                <button
                  onClick={() => {
                    const base =
                      outputStyle === "memo"
                        ? "taxaipro-memo"
                        : outputStyle === "email"
                        ? "taxaipro-email"
                        : "taxaipro-answer";
                    downloadText(`${base}.txt`, displayText);
                  }}
                  className="rounded-xl border border-white/15 px-3 py-1.5 text-xs text-white/85 hover:bg-white/5"
                >
                  Download
                </button>
              </div>
            </div>

            <div className="mt-3 rounded-2xl border border-white/10 bg-black/30 p-3">
              <pre className="whitespace-pre-wrap text-sm leading-relaxed text-white/90">
                {displayText || "—"}
              </pre>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                <SectionTitle hint="Assumptions + edge cases">
                  Caveats
                </SectionTitle>
                <ul className="mt-2 list-disc pl-5 text-sm text-white/80 space-y-1">
                  {(resp?.consensus?.caveats ?? []).length ? (
                    (resp?.consensus?.caveats ?? []).map((c, i) => (
                      <li key={i}>{c}</li>
                    ))
                  ) : (
                    <li className="list-none text-white/50">None yet.</li>
                  )}
                </ul>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                <SectionTitle hint="Paste these into Facts, then re-run">
                  Missing facts
                </SectionTitle>
                <ul className="mt-2 list-disc pl-5 text-sm text-white/80 space-y-1">
                  {(resp?.consensus?.followups ?? []).length ? (
                    (resp?.consensus?.followups ?? []).map((c, i) => (
                      <li key={i}>{c}</li>
                    ))
                  ) : (
                    <li className="list-none text-white/50">None yet.</li>
                  )}
                </ul>
              </div>
            </div>

            {resp?.providers?.length ? (
              <details className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                <summary className="cursor-pointer text-xs font-semibold tracking-wide text-white/70 uppercase">
                  Provider outputs (debug)
                </summary>
                <div className="mt-3 space-y-3">
                  {resp.providers.map((p, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-white/10 bg-black/30 p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs text-white/70">
                          <span className="font-semibold text-white/90">
                            {p.provider}
                          </span>{" "}
                          · {p.model}
                        </div>
                        <div className="text-xs text-white/50">{p.ms}ms</div>
                      </div>
                      <div className="mt-2 text-sm whitespace-pre-wrap text-white/80">
                        {p.status === "ok" ? p.text : p.error}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}

            <p className="mt-4 text-[11px] text-white/40">
              TaxAiPro generates drafts for triage only — not legal or tax advice.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

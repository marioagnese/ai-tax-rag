"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUp,
  BadgeHelp,
  BookOpenText,
  Bot,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  CornerDownRight,
  CreditCard,
  FileSearch,
  History,
  Home,
  LogOut,
  Mail,
  Paperclip,
  Plus,
  PlusCircle,
  SearchCheck,
  ShieldAlert,
  Sparkles,
  User2,
  X,
} from "lucide-react";

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

type SavedAnalysis = {
  id: string;
  title: string;
  question: string;
  answer?: string;
  confidence?: "low" | "medium" | "high";
  createdAt: number;
};

const LS_HISTORY_KEY = "taxaipro_v2_history";
const MAX_DOCS = 3;
const ALLOWED_DOC_TYPES = [
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function formatTimeAgo(ts: number) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function smartTitle(text: string) {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (!cleaned) return "Untitled analysis";
  return cleaned.length > 52 ? `${cleaned.slice(0, 52)}…` : cleaned;
}

function ConfidencePill({
  value,
}: {
  value?: "low" | "medium" | "high";
}) {
  const tone =
    value === "high"
      ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
      : value === "medium"
      ? "border-amber-400/25 bg-amber-400/10 text-amber-200"
      : "border-red-400/25 bg-red-400/10 text-red-200";

  const label = value ? value[0].toUpperCase() + value.slice(1) : "Low";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium",
        tone
      )}
    >
      {label} confidence
    </span>
  );
}

function SidebarSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="mb-2 px-2 text-[11px] font-medium uppercase tracking-[0.18em] text-white/32">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function NavButton({
  icon,
  label,
  active = false,
  trailing,
  disabled = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  trailing?: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
        active
          ? "border border-white/10 bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
          : "text-white/68 hover:bg-white/[0.06] hover:text-white",
        disabled &&
          "cursor-not-allowed opacity-45 hover:bg-transparent hover:text-white/68"
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className={cn("shrink-0", active ? "text-white/80" : "text-white/45")}>
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </span>
      {trailing ? <span className="text-white/30">{trailing}</span> : null}
    </button>
  );
}

function NavLinkItem({
  href,
  icon,
  label,
  active = false,
  trailing,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
        active
          ? "border border-white/10 bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
          : "text-white/68 hover:bg-white/[0.06] hover:text-white"
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className={cn("shrink-0", active ? "text-white/80" : "text-white/45")}>
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </span>
      {trailing ? <span className="text-white/30">{trailing}</span> : null}
    </Link>
  );
}

function HistoryItem({
  item,
  selected,
  onClick,
}: {
  item: SavedAnalysis;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
        selected
          ? "border-white/12 bg-white/10"
          : "border-transparent bg-transparent hover:border-white/8 hover:bg-white/[0.04]"
      )}
    >
      <div className="truncate text-sm text-white/82">{item.title}</div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="truncate text-xs text-white/36">
          {item.confidence ? `${item.confidence} confidence` : "draft"}
        </div>
        <div className="shrink-0 text-[11px] text-white/30">
          {formatTimeAgo(item.createdAt)}
        </div>
      </div>
    </button>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#111827] px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.12)]">
      <div className="mb-1 flex items-center gap-2 text-white/44">
        {icon}
        <span className="text-[11px] uppercase tracking-[0.16em]">{label}</span>
      </div>
      <div className="text-sm font-medium text-white/84">{value}</div>
    </div>
  );
}

function DetailSection({
  title,
  subtitle,
  items,
  empty,
}: {
  title: string;
  subtitle?: string;
  items?: string[];
  empty: string;
}) {
  return (
    <details className="group rounded-2xl border border-white/10 bg-[#111827]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 marker:content-none">
        <div>
          <div className="text-sm font-medium text-white/86">{title}</div>
          {subtitle ? (
            <div className="mt-1 text-xs text-white/42">{subtitle}</div>
          ) : null}
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-white/35 transition group-open:rotate-90" />
      </summary>

      <div className="border-t border-white/10 px-4 py-4">
        {items && items.length ? (
          <ul className="space-y-2">
            {items.map((item, i) => (
              <li
                key={`${title}-${i}`}
                className="flex gap-2 text-sm leading-6 text-white/72"
              >
                <span className="mt-[10px] h-1.5 w-1.5 shrink-0 rounded-full bg-white/35" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm leading-6 text-white/50">{empty}</div>
        )}
      </div>
    </details>
  );
}

export default function CrosscheckV2Page() {
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "en";

  const [question, setQuestion] = useState("");
  const [details, setDetails] = useState("");
  const [showDetails, setShowDetails] = useState(false);

  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [uploadError, setUploadError] = useState("");

  const [answer, setAnswer] = useState("");
  const [confidence, setConfidence] = useState<"low" | "medium" | "high" | "">(
    ""
  );
  const [caveats, setCaveats] = useState<string[]>([]);
  const [followups, setFollowups] = useState<string[]>([]);
  const [disagreements, setDisagreements] = useState<string[]>([]);
  const [runtimeMs, setRuntimeMs] = useState<number | null>(null);
  const [attemptedCount, setAttemptedCount] = useState<number>(0);
  const [successCount, setSuccessCount] = useState<number>(0);

  const [history, setHistory] = useState<SavedAnalysis[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(true);
  const [showPrompts, setShowPrompts] = useState(true);

  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_HISTORY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SavedAnalysis[];
      if (Array.isArray(parsed)) {
        setHistory(parsed);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(history));
    } catch {}
  }, [history]);

  const canSubmit = useMemo(() => {
    return question.trim().length > 0 && !loading;
  }, [question, loading]);

  function resetCurrentAnalysis() {
    setQuestion("");
    setDetails("");
    setShowDetails(false);
    setLoading(false);
    setRequestError("");
    setUploadError("");
    setAnswer("");
    setConfidence("");
    setCaveats([]);
    setFollowups([]);
    setDisagreements([]);
    setRuntimeMs(null);
    setAttemptedCount(0);
    setSuccessCount(0);
    setSelectedHistoryId(null);
    setAttachedFiles([]);
  }

  function handleFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(event.target.files || []);
    if (!incoming.length) return;

    setUploadError("");

    const merged = [...attachedFiles, ...incoming];

    if (merged.length > MAX_DOCS) {
      setUploadError(`You can attach up to ${MAX_DOCS} files.`);
      event.target.value = "";
      return;
    }

    const invalid = incoming.find(
      (file) => file.type && !ALLOWED_DOC_TYPES.includes(file.type)
    );

    if (invalid) {
      setUploadError("Only TXT and DOCX files are supported right now.");
      event.target.value = "";
      return;
    }

    setAttachedFiles(merged);
    event.target.value = "";
  }

  function removeAttachedFile(index: number) {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function runAnalysis(overrides?: {
    question?: string;
    details?: string;
  }) {
    const nextQuestion = (overrides?.question ?? question).trim();
    const nextDetails = (overrides?.details ?? details).trim();

    if (!nextQuestion || loading) return;

    setLoading(true);
    setRequestError("");
    setAnswer("");
    setConfidence("");
    setCaveats([]);
    setFollowups([]);
    setDisagreements([]);
    setRuntimeMs(null);
    setAttemptedCount(0);
    setSuccessCount(0);

    try {
      let res: Response;

      if (attachedFiles.length > 0) {
        const form = new FormData();
        form.append("question", nextQuestion);
        if (nextDetails) form.append("facts", nextDetails);
        attachedFiles.forEach((file) => form.append("files", file));

        res = await fetch("/api/ui/crosscheck", {
          method: "POST",
          body: form,
        });
      } else {
        res = await fetch("/api/ui/crosscheck", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            question: nextQuestion,
            facts: nextDetails || undefined,
          }),
        });
      }

      const data = (await res.json()) as CrosscheckResponse;

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Crosscheck request failed.");
      }

      const nextAnswer = data?.consensus?.answer || "No answer returned.";

      setAnswer(nextAnswer);
      setConfidence(data?.consensus?.confidence || "");
      setCaveats(data?.consensus?.caveats || []);
      setFollowups(data?.consensus?.followups || []);
      setDisagreements(data?.consensus?.disagreements || []);
      setRuntimeMs(
        typeof data?.meta?.runtime_ms === "number" ? data.meta.runtime_ms : null
      );
      setAttemptedCount(data?.meta?.attempted?.length || 0);
      setSuccessCount(data?.meta?.succeeded?.length || 0);

      const item: SavedAnalysis = {
        id: crypto.randomUUID(),
        title: smartTitle(nextQuestion),
        question: nextQuestion,
        answer: nextAnswer,
        confidence: data?.consensus?.confidence,
        createdAt: Date.now(),
      };

      setHistory((prev) => [item, ...prev].slice(0, 20));
      setSelectedHistoryId(item.id);
    } catch (err) {
      setRequestError(
        err instanceof Error ? err.message : "Error running analysis."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    await runAnalysis();
  }

  async function handleRefineAnswer() {
    if (!question.trim() || !answer.trim() || loading) return;

    const refinedQuestion = [
      question.trim(),
      "",
      "Please refine the prior answer into a tighter, more conservative tax analysis. Resolve ambiguity where possible, state the conclusion clearly, and highlight any conditions that could change the result.",
      "",
      `Prior draft answer:\n${answer.trim()}`,
    ].join("\n");

    setQuestion(refinedQuestion);
    await runAnalysis({ question: refinedQuestion });
  }

  function handleAddMissingFacts() {
    setShowDetails(true);

    if (!details.trim()) {
      const seed =
        followups.length > 0
          ? followups.map((f) => `- ${f}`).join("\n")
          : "- Add the facts most likely to change the conclusion.";

      setDetails(seed);
    }
  }

  async function handleUseFollowup(followup: string) {
    setQuestion(followup);
    await runAnalysis({ question: followup });
  }

  function loadHistoryItem(item: SavedAnalysis) {
    setSelectedHistoryId(item.id);
    setQuestion(item.question);
    setDetails("");
    setShowDetails(false);
    setLoading(false);
    setRequestError("");
    setAnswer(item.answer || "");
    setConfidence(item.confidence || "");
    setCaveats([]);
    setFollowups([]);
    setDisagreements([]);
    setRuntimeMs(null);
    setAttemptedCount(0);
    setSuccessCount(0);
  }

  function handleLogout() {
    try {
      localStorage.removeItem(LS_HISTORY_KEY);
    } catch {}
    window.location.assign(`/${locale}`);
  }

  const sidebarPrompts = [
    "Does this create permanent establishment risk?",
    "What changes if services are performed locally?",
    "Is withholding tax exposure likely under these facts?",
  ];

  return (
    <main className="flex min-h-screen bg-[#0B1220] text-white">
      <aside className="flex w-72 shrink-0 flex-col justify-between border-r border-white/10 bg-[#0F172A] p-4">
        <div className="min-h-0">
          <div className="mb-6 flex items-center gap-3">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#111827] shadow-sm">
              <Image
                src="/taxaipro-logo.png"
                alt="TaxAiPro logo"
                width={44}
                height={44}
                className="h-11 w-11 object-cover"
                priority
              />
            </div>
            <div>
              <div className="text-lg font-semibold text-white/92">TaxAiPro™</div>
              <div className="text-xs text-white/42">
                Multi-model tax analysis
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={resetCurrentAnalysis}
            className="mb-5 flex w-full items-center gap-2 rounded-2xl border border-white/10 bg-[#162033] px-3.5 py-3 text-left text-sm text-white transition-colors hover:bg-[#1A2740]"
          >
            <Plus size={16} className="text-white/76" />
            <span>New analysis</span>
          </button>

          <SidebarSection title="Workspace">
            <NavLinkItem
              href={`/${locale}/crosscheck-v2`}
              icon={<Home size={16} />}
              label="Home"
              active
            />
            <NavButton
              icon={<History size={16} />}
              label="History"
              trailing={
                <ChevronDown
                  size={14}
                  className={cn("transition", showHistory ? "rotate-180" : "")}
                />
              }
              onClick={() => setShowHistory((v) => !v)}
            />

            {showHistory ? (
              <div className="mt-2 space-y-1 pl-2">
                {history.length ? (
                  history.map((item) => (
                    <HistoryItem
                      key={item.id}
                      item={item}
                      selected={selectedHistoryId === item.id}
                      onClick={() => loadHistoryItem(item)}
                    />
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-3 py-4 text-sm leading-6 text-white/46">
                    Your recent analyses will appear here.
                  </div>
                )}
              </div>
            ) : null}

            <NavButton
              icon={<Sparkles size={16} />}
              label="Suggested prompts"
              trailing={
                <ChevronDown
                  size={14}
                  className={cn("transition", showPrompts ? "rotate-180" : "")}
                />
              }
              onClick={() => setShowPrompts((v) => !v)}
            />

            {showPrompts ? (
              <div className="mt-2 space-y-2 pl-2">
                {sidebarPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setQuestion(prompt)}
                    className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-[#111827] px-3 py-3 text-left text-sm text-white/72 transition hover:bg-white/[0.05] hover:text-white"
                  >
                    <span className="pr-3">{prompt}</span>
                    <ArrowRight size={15} className="shrink-0 text-white/34" />
                  </button>
                ))}
              </div>
            ) : null}
          </SidebarSection>

          <SidebarSection title="Platform">
            <NavLinkItem
              href={`/${locale}/how-it-works`}
              icon={<BadgeHelp size={16} />}
              label="How it works"
            />
            <NavLinkItem
              href={`/${locale}/plans`}
              icon={<CreditCard size={16} />}
              label="Billing & Plans"
            />
            <NavLinkItem
              href={`/${locale}/corporate`}
              icon={<Building2 size={16} />}
              label="Corporate"
            />
            <NavLinkItem
              href={`/${locale}/formal-opinion-quote`}
              icon={<FileSearch size={16} />}
              label="Request formal opinion"
            />
            <NavLinkItem
              href={`/${locale}/contact`}
              icon={<Mail size={16} />}
              label="Contact us"
            />
          </SidebarSection>
        </div>

        <div className="border-t border-white/10 pt-4">
          <div className="mb-2 text-xs text-white/35">Logged in as</div>
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white/84">
            <User2 size={15} className="text-white/45" />
            <span>Mario</span>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-2 rounded-xl px-2 py-2 text-sm text-white/55 transition-colors hover:bg-white/[0.05] hover:text-white/82"
          >
            <LogOut size={16} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-white/8 px-8 py-6">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/50">
              <Bot size={14} />
              <span>V2 redesign sandbox</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-white/95">
              Good morning, Mario
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/56">
              Ask the question naturally. Add facts only when they matter.
              TaxAiPro will cross-check multiple models and return one
              conservative draft.
            </p>
          </div>
        </header>

        <div className="flex-1 px-6 py-8">
          <div className="mx-auto w-full max-w-5xl">
            <div className="grid gap-6">
              <div className="min-w-0">
                <div className="rounded-[30px] border border-white/12 bg-[#111827] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
                  <div className="mb-3 flex items-center gap-2 text-xs text-white/42">
                    <SearchCheck size={14} />
                    <span>Start with the question</span>
                  </div>

                  <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Example: Does a US buyer purchasing goods FOB from Colombia create PE risk or withholding exposure if support services are also performed locally?"
                    className="min-h-[180px] w-full resize-none bg-transparent text-[15px] leading-7 text-white/88 outline-none placeholder:text-white/28"
                  />

                  {showDetails ? (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-[#0F172A] p-3">
                      <div className="mb-2 flex items-center gap-2 text-xs text-white/44">
                        <BookOpenText size={14} />
                        <span>Optional details</span>
                      </div>
                      <textarea
                        value={details}
                        onChange={(e) => setDetails(e.target.value)}
                        placeholder="Entity type, residency, treaty position, who performs services, where title passes, who bears risk, contract terms, value, related-party facts, etc."
                        className="min-h-[110px] w-full resize-none bg-transparent text-sm leading-6 text-white/82 outline-none placeholder:text-white/28"
                      />
                    </div>
                  ) : null}

                  <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-[#0F172A] p-3">
                    <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-white/42">
                      <Paperclip size={14} />
                      <span>Attach documents</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/78 transition hover:bg-white/[0.08] hover:text-white">
                        <Paperclip size={14} />
                        <span>Add files</span>
                        <input
                          type="file"
                          multiple
                          accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                          className="hidden"
                          onChange={handleFilesSelected}
                        />
                      </label>

                      <div className="text-xs text-white/40">
                        Up to {MAX_DOCS} files. TXT and DOCX only.
                      </div>
                    </div>

                    {uploadError ? (
                      <div className="mt-3 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-200">
                        {uploadError}
                      </div>
                    ) : null}

                    {attachedFiles.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {attachedFiles.map((file, index) => (
                          <div
                            key={`${file.name}-${index}`}
                            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/78"
                          >
                            <Paperclip size={12} />
                            <span className="max-w-[220px] truncate">{file.name}</span>
                            <button
                              type="button"
                              onClick={() => removeAttachedFile(index)}
                              className="rounded-full p-0.5 text-white/45 transition hover:bg-white/[0.08] hover:text-white"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowDetails((v) => !v)}
                        className="rounded-xl border border-white/10 bg-[#0F172A] px-3 py-2 text-sm text-white/72 transition hover:bg-white/[0.05]"
                      >
                        {showDetails ? "Hide details" : "Add details"}
                      </button>
                      <div className="text-xs text-white/40">
                        Cleaner input. Better output.
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={!canSubmit}
                      className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-[#0B1220] transition-colors hover:bg-white/92 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loading ? (
                        <>
                          <Clock3 size={16} />
                          <span>Cross-checking...</span>
                        </>
                      ) : (
                        <>
                          <span>Ask TaxAiPro</span>
                          <ArrowUp size={16} />
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {requestError ? (
                  <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/10 p-4">
                    <div className="flex items-start gap-3">
                      <ShieldAlert className="mt-0.5 shrink-0 text-red-300" size={18} />
                      <div>
                        <div className="text-sm font-medium text-red-200">
                          Analysis could not be completed
                        </div>
                        <div className="mt-1 text-sm leading-6 text-red-200/85">
                          {requestError}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {(answer || loading) && (
                  <div className="mt-6 space-y-4">
                    <div className="rounded-3xl border border-white/12 bg-[#111827] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 size={18} className="text-white/72" />
                          <h2 className="text-base font-semibold text-white/90">
                            Preliminary answer
                          </h2>
                        </div>

                        {confidence ? <ConfidencePill value={confidence} /> : null}
                      </div>

                      {loading ? (
                        <div className="space-y-3">
                          <div className="h-4 w-full animate-pulse rounded bg-white/10" />
                          <div className="h-4 w-[94%] animate-pulse rounded bg-white/10" />
                          <div className="h-4 w-[86%] animate-pulse rounded bg-white/10" />
                          <div className="h-4 w-[70%] animate-pulse rounded bg-white/10" />
                        </div>
                      ) : (
                        <>
                          <div className="whitespace-pre-wrap text-[15px] leading-7 text-white/82">
                            {answer}
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-4">
                            <button
                              type="button"
                              onClick={handleRefineAnswer}
                              disabled={loading || !answer.trim()}
                              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/78 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Sparkles size={14} />
                              <span>Refine answer</span>
                            </button>

                            <button
                              type="button"
                              onClick={handleAddMissingFacts}
                              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/78 transition hover:bg-white/[0.08] hover:text-white"
                            >
                              <PlusCircle size={14} />
                              <span>Add missing facts</span>
                            </button>
                          </div>

                          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {runtimeMs !== null ? (
                              <Metric
                                icon={<Clock3 size={14} />}
                                label="Runtime"
                                value={`${runtimeMs} ms`}
                              />
                            ) : null}

                            {attemptedCount > 0 ? (
                              <Metric
                                icon={<Bot size={14} />}
                                label="Models attempted"
                                value={`${attemptedCount}`}
                              />
                            ) : null}

                            {successCount > 0 ? (
                              <Metric
                                icon={<CheckCircle2 size={14} />}
                                label="Models succeeded"
                                value={`${successCount}`}
                              />
                            ) : null}
                          </div>
                        </>
                      )}
                    </div>

                    <DetailSection
                      title="Key caveats"
                      subtitle="What could change the conclusion."
                      items={caveats}
                      empty="No explicit caveats were returned in this run."
                    />

                    <div className="rounded-2xl border border-white/10 bg-[#111827]">
                      <div className="border-b border-white/10 px-4 py-3.5">
                        <div className="text-sm font-medium text-white/86">
                          Follow-up questions
                        </div>
                        <div className="mt-1 text-xs text-white/42">
                          Useful next questions to tighten the analysis.
                        </div>
                      </div>

                      <div className="px-4 py-4">
                        {followups.length ? (
                          <div className="space-y-2">
                            {followups.map((followup, i) => (
                              <button
                                key={`${followup}-${i}`}
                                type="button"
                                onClick={() => handleUseFollowup(followup)}
                                className="flex w-full items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-left text-sm text-white/72 transition hover:bg-white/[0.08] hover:text-white"
                              >
                                <span>{followup}</span>
                                <CornerDownRight
                                  size={14}
                                  className="mt-0.5 shrink-0 text-white/35"
                                />
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm leading-6 text-white/50">
                            No follow-up questions were suggested in this run.
                          </div>
                        )}
                      </div>
                    </div>

                    <DetailSection
                      title="Model disagreements"
                      subtitle="Where provider outputs likely diverged."
                      items={disagreements}
                      empty="No explicit disagreements were surfaced in this run."
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
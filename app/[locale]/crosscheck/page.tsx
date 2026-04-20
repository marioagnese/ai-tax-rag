"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import LanguageToggle from "../components/LanguageToggle";
import {
  ArrowRight,
  ArrowUp,
  BadgeHelp,
  BookOpenText,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  CornerDownRight,
  CreditCard,
  FileSearch,
  History,
  Home,
  LogOut,
  Mail,
  Paperclip,
  PanelLeft,
  Plus,
  PlusCircle,
  SearchCheck,
  ShieldAlert,
  Sparkles,
  User2,
  Wrench,
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

type AnalysisTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt?: number;
};

type SavedDocument = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  status?: "uploading" | "processing" | "ready" | "error";
  extractedText?: string;
  summary?: string;
  error?: string;
};

type SavedAnalysis = {
  id: string;
  runId?: string;
  title: string;
  question: string;
  answer?: string;
  confidence?: "low" | "medium" | "high";
  createdAt: number;
  updatedAt?: number;
  caveats?: string[];
  followups?: string[];
  disagreements?: string[];
  thread?: AnalysisTurn[];
  documents?: SavedDocument[];
};

type ProviderOutput = NonNullable<CrosscheckResponse["providers"]>[number];

type PersistedHistoryResponse = {
  ok: boolean;
  tier?: "0" | "1" | "2";
  runs?: Array<{
    id: string;
    title: string;
    question: string;
    answer?: string;
    confidence?: "low" | "medium" | "high";
    createdAt: number;
    updatedAt?: number;
    caveats?: string[];
    followups?: string[];
    disagreements?: string[];
    thread?: AnalysisTurn[];
    documents?: SavedDocument[];
  }>;
  error?: string;
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

function formatTimeAgo(ts: number, locale?: string) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(locale);
}

function smartTitle(text: string) {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (!cleaned) return "Untitled analysis";
  return cleaned.length > 52 ? `${cleaned.slice(0, 52)}…` : cleaned;
}

function normalizeSavedAnalyses(items: SavedAnalysis[]) {
  return [...items]
    .filter((item) => item && typeof item === "object" && item.id && item.question)
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
    .slice(0, 20);
}

function CopyButton({
  text,
  label,
  copiedLabel,
  copyKey,
  copiedKey,
  onCopy,
  className,
}: {
  text: string;
  label: string;
  copiedLabel: string;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (key: string, value: string) => void;
  className?: string;
}) {
  const copied = copiedKey === copyKey;

  return (
    <button
      type="button"
      onClick={() => onCopy(copyKey, text)}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/78 transition hover:bg-white/[0.08] hover:text-white",
        className
      )}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      <span>{copied ? copiedLabel : label}</span>
    </button>
  );
}

function ConfidencePill({
  value,
  label,
}: {
  value?: "low" | "medium" | "high";
  label: string;
}) {
  const tone =
    value === "high"
      ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
      : value === "medium"
      ? "border-amber-400/25 bg-amber-400/10 text-amber-200"
      : "border-red-400/25 bg-red-400/10 text-red-200";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium",
        tone
      )}
    >
      {label}
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
  confidenceLabel,
  draftLabel,
  locale,
}: {
  item: SavedAnalysis;
  selected: boolean;
  onClick: () => void;
  confidenceLabel: string;
  draftLabel: string;
  locale: string;
}) {
  const stamp = item.updatedAt || item.createdAt;

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
          {item.confidence ? `${item.confidence} ${confidenceLabel}` : draftLabel}
        </div>
        <div className="shrink-0 text-[11px] text-white/30">
          {formatTimeAgo(stamp, locale)}
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
  copyLabel,
  copiedLabel,
  copyKey,
  copiedKey,
  onCopy,
}: {
  title: string;
  subtitle?: string;
  items?: string[];
  empty: string;
  copyLabel: string;
  copiedLabel: string;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (key: string, value: string) => void;
}) {
  const copyText = items?.length ? items.map((item) => `• ${item}`).join("\n") : "";

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
          <>
            <div className="mb-3 flex justify-end">
              <CopyButton
                text={copyText}
                label={copyLabel}
                copiedLabel={copiedLabel}
                copyKey={copyKey}
                copiedKey={copiedKey}
                onCopy={onCopy}
              />
            </div>
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
          </>
        ) : (
          <div className="text-sm leading-6 text-white/50">{empty}</div>
        )}
      </div>
    </details>
  );
}

function ProviderCard({
  provider,
  emptyText,
  copyLabel,
  copiedLabel,
  copyKey,
  copiedKey,
  onCopy,
}: {
  provider: ProviderOutput;
  emptyText: string;
  copyLabel: string;
  copiedLabel: string;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (key: string, value: string) => void;
}) {
  const statusTone =
    provider.status === "ok"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
      : provider.status === "timeout"
      ? "border-amber-400/20 bg-amber-400/10 text-amber-200"
      : "border-red-400/20 bg-red-400/10 text-red-200";

  const providerBody = provider.error
    ? provider.error
    : provider.text || "";

  return (
    <div className="rounded-2xl border border-white/10 bg-[#111827] p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-white/88">
            {provider.provider} · {provider.model}
          </div>
          <div className="mt-1 text-xs text-white/40">{provider.ms} ms</div>
        </div>

        <div className="flex items-center gap-2">
          {providerBody ? (
            <CopyButton
              text={providerBody}
              label={copyLabel}
              copiedLabel={copiedLabel}
              copyKey={copyKey}
              copiedKey={copiedKey}
              onCopy={onCopy}
              className="px-2.5 py-1.5 text-xs"
            />
          ) : null}
          <span className={cn("rounded-full border px-2.5 py-1 text-xs", statusTone)}>
            {provider.status}
          </span>
        </div>
      </div>

      {provider.error ? (
        <div className="text-sm leading-6 text-red-200/85">{provider.error}</div>
      ) : provider.text ? (
        <div className="max-h-48 overflow-auto whitespace-pre-wrap text-sm leading-6 text-white/72">
          {provider.text}
        </div>
      ) : (
        <div className="text-sm text-white/45">{emptyText}</div>
      )}
    </div>
  );
}

function SidebarContent({
  locale,
  showHistory,
  setShowHistory,
  showPrompts,
  setShowPrompts,
  history,
  selectedHistoryId,
  loadHistoryItem,
  sidebarPrompts,
  setQuestion,
  resetCurrentAnalysis,
  handleLogout,
  diagnosticsRef,
  labels,
}: {
  locale: string;
  showHistory: boolean;
  setShowHistory: React.Dispatch<React.SetStateAction<boolean>>;
  showPrompts: boolean;
  setShowPrompts: React.Dispatch<React.SetStateAction<boolean>>;
  history: SavedAnalysis[];
  selectedHistoryId: string | null;
  loadHistoryItem: (item: SavedAnalysis) => void;
  sidebarPrompts: string[];
  setQuestion: React.Dispatch<React.SetStateAction<string>>;
  resetCurrentAnalysis: () => void;
  handleLogout: () => void;
  diagnosticsRef: React.RefObject<HTMLDivElement | null>;
  labels: {
    logoTagline: string;
    newAnalysis: string;
    workspace: string;
    home: string;
    history: string;
    suggestedPrompts: string;
    emptyHistory: string;
    platform: string;
    howItWorks: string;
    billingPlans: string;
    corporate: string;
    requestFormalOpinion: string;
    contactUs: string;
    diagnostics: string;
    loggedInAs: string;
    logout: string;
    confidenceWord: string;
    draft: string;
  };
}) {
  return (
    <div className="flex h-full flex-col justify-between">
      <div className="min-h-0 overflow-y-auto pr-1">
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
            <div className="text-xs text-white/42">{labels.logoTagline}</div>
          </div>
        </div>

        <button
          type="button"
          onClick={resetCurrentAnalysis}
          className="mb-5 flex w-full items-center gap-2 rounded-2xl border border-white/10 bg-[#162033] px-3.5 py-3 text-left text-sm text-white transition-colors hover:bg-[#1A2740]"
        >
          <Plus size={16} className="text-white/76" />
          <span>{labels.newAnalysis}</span>
        </button>

        <SidebarSection title={labels.workspace}>
          <NavLinkItem
            href={`/${locale}/crosscheck`}
            icon={<Home size={16} />}
            label={labels.home}
            active
          />

          <NavButton
            icon={<History size={16} />}
            label={labels.history}
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
                    confidenceLabel={labels.confidenceWord}
                    draftLabel={labels.draft}
                    locale={locale}
                  />
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-3 py-4 text-sm leading-6 text-white/46">
                  {labels.emptyHistory}
                </div>
              )}
            </div>
          ) : null}

          <NavButton
            icon={<Sparkles size={16} />}
            label={labels.suggestedPrompts}
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

        <SidebarSection title={labels.platform}>
          <NavLinkItem
            href={`/${locale}/how-it-works`}
            icon={<BadgeHelp size={16} />}
            label={labels.howItWorks}
          />
          <NavLinkItem
            href={`/${locale}/plans`}
            icon={<CreditCard size={16} />}
            label={labels.billingPlans}
          />
          <NavLinkItem
            href={`/${locale}/corporate`}
            icon={<Building2 size={16} />}
            label={labels.corporate}
          />
          <NavLinkItem
            href={`/${locale}/formal-opinion-quote`}
            icon={<FileSearch size={16} />}
            label={labels.requestFormalOpinion}
          />
          <NavLinkItem
            href={`/${locale}/contact`}
            icon={<Mail size={16} />}
            label={labels.contactUs}
          />
          <NavButton
            icon={<Wrench size={16} />}
            label={labels.diagnostics}
            onClick={() =>
              diagnosticsRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              })
            }
          />
        </SidebarSection>
      </div>

      <div className="mt-4 border-t border-white/10 pt-4">
        <div className="mb-2 text-xs text-white/35">{labels.loggedInAs}</div>
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
          <span>{labels.logout}</span>
        </button>
      </div>
    </div>
  );
}

export default function CrosscheckV2Page() {
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "en";
  const diagnosticsRef = useRef<HTMLDivElement | null>(null);
  const t = useTranslations("crosscheck");
  const tv2 = useTranslations("crosscheck.v2");

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
  const [providers, setProviders] = useState<ProviderOutput[]>([]);
  const [runtimeMs, setRuntimeMs] = useState<number | null>(null);
  const [attemptedCount, setAttemptedCount] = useState<number>(0);
  const [successCount, setSuccessCount] = useState<number>(0);

  const [history, setHistory] = useState<SavedAnalysis[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showPrompts, setShowPrompts] = useState(false);

  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);

  const [baseQuestion, setBaseQuestion] = useState("");
  const [followupDraft, setFollowupDraft] = useState("");
  const [conversationTurns, setConversationTurns] = useState<AnalysisTurn[]>([]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [historyBootstrapped, setHistoryBootstrapped] = useState(false);
  const [analysisStartedAt, setAnalysisStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      let localItems: SavedAnalysis[] = [];

      try {
        const raw = localStorage.getItem(LS_HISTORY_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as SavedAnalysis[];
          if (Array.isArray(parsed)) {
            localItems = normalizeSavedAnalyses(parsed);
          }
        }
      } catch {}

      try {
        const res = await fetch("/api/runs/history?limit=20", {
          method: "GET",
          cache: "no-store",
        });

        const data = (await res.json()) as PersistedHistoryResponse;

        if (!cancelled && res.ok && data?.ok && Array.isArray(data.runs)) {
          const backendRuns: SavedAnalysis[] = normalizeSavedAnalyses(
            data.runs.map((run) => ({
              id: run.id,
              runId: run.id,
              title: run.title || smartTitle(run.question || ""),
              question: run.question || "",
              answer: run.answer || "",
              confidence: run.confidence,
              createdAt: run.createdAt || Date.now(),
              updatedAt: run.updatedAt,
              caveats: run.caveats || [],
              followups: run.followups || [],
              disagreements: run.disagreements || [],
              thread: run.thread || [],
              documents: run.documents || [],
            }))
          );

          setHistory(backendRuns);

          try {
            localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(backendRuns));
          } catch {}
        } else if (!cancelled && localItems.length) {
          setHistory(localItems);
        }
      } catch {
        if (!cancelled && localItems.length) {
          setHistory(localItems);
        }
      } finally {
        if (!cancelled) {
          setHistoryBootstrapped(true);
        }
      }
    }

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!historyBootstrapped) return;
    try {
      localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(normalizeSavedAnalyses(history)));
    } catch {}
  }, [history, historyBootstrapped]);

  useEffect(() => {
    if (!copiedKey) return;
    const timer = window.setTimeout(() => setCopiedKey(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copiedKey]);

  useEffect(() => {
    if (!loading || !analysisStartedAt) {
      setElapsedMs(0);
      return;
    }

    setElapsedMs(Date.now() - analysisStartedAt);

    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - analysisStartedAt);
    }, 100);

    return () => window.clearInterval(timer);
  }, [loading, analysisStartedAt]);


  const canSubmit = useMemo(() => {
    return question.trim().length > 0 && !loading;
  }, [question, loading]);

  const canSubmitFollowup = useMemo(() => {
    return baseQuestion.trim().length > 0 && followupDraft.trim().length > 0 && !loading;
  }, [baseQuestion, followupDraft, loading]);

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
    setProviders([]);
    setRuntimeMs(null);
    setAttemptedCount(0);
    setSuccessCount(0);
    setSelectedHistoryId(null);
    setAttachedFiles([]);
    setBaseQuestion("");
    setFollowupDraft("");
    setConversationTurns([]);
    setSidebarOpen(false);
    setCurrentRunId(null);
    setAnalysisStartedAt(null);
    setElapsedMs(0);
  }

  function handleFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(event.target.files || []);
    if (!incoming.length) return;

    setUploadError("");

    const merged = [...attachedFiles, ...incoming];

    if (merged.length > MAX_DOCS) {
      setUploadError(tv2("uploadLimit", { count: MAX_DOCS }));
      event.target.value = "";
      return;
    }

    const invalid = incoming.find(
      (file) => file.type && !ALLOWED_DOC_TYPES.includes(file.type)
    );

    if (invalid) {
      setUploadError(tv2("uploadInvalidType"));
      event.target.value = "";
      return;
    }

    setAttachedFiles(merged);
    event.target.value = "";
  }

  function removeAttachedFile(index: number) {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCopy(copyKey: string, value: string) {
    if (!value?.trim()) return;

    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(copyKey);
    } catch {
      setCopiedKey(null);
    }
  }

  function buildConversationPrompt(
    originalQuestion: string,
    turns: AnalysisTurn[],
    nextUserTurn: string
  ) {
    const priorTurns = turns
      .map((turn) =>
        turn.role === "user"
          ? `User follow-up: ${turn.text}`
          : `Assistant answer: ${turn.text}`
      )
      .join("\n\n");

    return [
      `Original question:\n${originalQuestion}`,
      priorTurns ? `Prior conversation:\n${priorTurns}` : "",
      `New follow-up:\n${nextUserTurn}`,
      "Answer this as a continuation of the same tax analysis, preserving context from the original question and prior answers.",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  async function persistRun(args: {
    runId?: string | null;
    title: string;
    question: string;
    answer: string;
    confidence?: "low" | "medium" | "high" | "";
    caveats: string[];
    followups: string[];
    disagreements: string[];
    thread: AnalysisTurn[];
    documents?: SavedDocument[];
  }) {
    try {
      const res = await fetch("/api/runs/autosave", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          runId: args.runId || undefined,
          title: args.title,
          question: args.question,
          answer: args.answer,
          confidence: args.confidence || undefined,
          caveats: args.caveats,
          followups: args.followups,
          disagreements: args.disagreements,
          facts: details.trim() || undefined,
          thread: args.thread.map((turn) => ({
            id: turn.id,
            role: turn.role,
            text: turn.text,
            createdAt: turn.createdAt || Date.now(),
          })),
          documents: args.documents || [],
        }),
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data?.ok && data?.runId) {
        setCurrentRunId(data.runId as string);

        setHistory((prev) =>
          normalizeSavedAnalyses(
            prev.map((item) =>
              item.id === (args.runId || currentRunId || "")
                ? { ...item, id: data.runId as string, runId: data.runId as string }
                : item
            )
          )
        );

        return data.runId as string;
      }
    } catch {}

    return args.runId || currentRunId || null;
  }

  async function executeAnalysis(args: {
    payloadQuestion: string;
    payloadDetails?: string;
  }) {
    if (!args.payloadQuestion.trim() || loading) return null;

    setLoading(true);
    setAnalysisStartedAt(Date.now());
    setElapsedMs(0);
    setRequestError("");
    setAnswer("");
    setConfidence("");
    setCaveats([]);
    setFollowups([]);
    setDisagreements([]);
    setProviders([]);
    setRuntimeMs(null);
    setAttemptedCount(0);
    setSuccessCount(0);

    try {
      let res: Response;

      if (attachedFiles.length > 0) {
        const form = new FormData();
        form.append("question", args.payloadQuestion);
        if (args.payloadDetails?.trim()) form.append("facts", args.payloadDetails.trim());
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
            question: args.payloadQuestion,
            facts: args.payloadDetails?.trim() || undefined,
          }),
        });
      }

      const data = (await res.json()) as CrosscheckResponse;

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || tv2("analysisFailedFallback"));
      }

      const nextAnswer = data?.consensus?.answer || tv2("noAnswerReturned");

      setAnswer(nextAnswer);
      setConfidence(data?.consensus?.confidence || "");
      setCaveats(data?.consensus?.caveats || []);
      setFollowups(data?.consensus?.followups || []);
      setDisagreements(data?.consensus?.disagreements || []);
      setProviders(data?.providers || []);
      setRuntimeMs(
        typeof data?.meta?.runtime_ms === "number" ? data.meta.runtime_ms : null
      );
      setAttemptedCount(data?.meta?.attempted?.length || 0);
      setSuccessCount(data?.meta?.succeeded?.length || 0);

      return {
        data,
        nextAnswer,
      };
    } catch (err) {
      setRequestError(
        err instanceof Error ? err.message : tv2("analysisErrorGeneric")
      );
      return null;
    } finally {
      setLoading(false);
      setAnalysisStartedAt(null);
    }
  }

  async function saveAnalysisRecord(args: {
    title: string;
    questionText: string;
    answerText: string;
    confidenceValue?: "low" | "medium" | "high" | "";
    caveatsValue: string[];
    followupsValue: string[];
    disagreementsValue: string[];
    threadValue: AnalysisTurn[];
  }) {
    const now = Date.now();

    const localId = currentRunId || crypto.randomUUID();

    const item: SavedAnalysis = {
      id: localId,
      runId: currentRunId || undefined,
      title: smartTitle(args.title),
      question: args.questionText,
      answer: args.answerText,
      confidence: args.confidenceValue || undefined,
      createdAt: now,
      updatedAt: now,
      caveats: args.caveatsValue,
      followups: args.followupsValue,
      disagreements: args.disagreementsValue,
      thread: args.threadValue,
      documents: attachedFiles.map((file, index) => ({
        id: `${file.name}-${index}-${file.size}`,
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        status: "ready",
      })),
    };

    setHistory((prev) => {
      const withoutSame = prev.filter((existing) => existing.id !== localId);
      return normalizeSavedAnalyses([item, ...withoutSame]);
    });
    setSelectedHistoryId(localId);

    const persistedRunId = await persistRun({
      runId: currentRunId,
      title: item.title,
      question: item.question,
      answer: item.answer || "",
      confidence: item.confidence,
      caveats: item.caveats || [],
      followups: item.followups || [],
      disagreements: item.disagreements || [],
      thread: item.thread || [],
      documents: item.documents || [],
    });

    if (persistedRunId && persistedRunId !== localId) {
      setHistory((prev) =>
        normalizeSavedAnalyses(
          prev.map((existing) =>
            existing.id === localId
              ? {
                  ...existing,
                  id: persistedRunId,
                  runId: persistedRunId,
                }
              : existing
          )
        )
      );
      setSelectedHistoryId(persistedRunId);
      setCurrentRunId(persistedRunId);
    }
  }

  async function handleSubmit() {
    const trimmed = question.trim();
    if (!trimmed) return;

    setBaseQuestion(trimmed);
    setConversationTurns([]);
    setCurrentRunId(null);

    const result = await executeAnalysis({
      payloadQuestion: trimmed,
      payloadDetails: details,
    });

    if (!result) return;

    const nextThread: AnalysisTurn[] = [
      {
        id: crypto.randomUUID(),
        role: "user",
        text: trimmed,
        createdAt: Date.now(),
      },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        text: result.nextAnswer,
        createdAt: Date.now(),
      },
    ];

    setConversationTurns(nextThread);

    await saveAnalysisRecord({
      title: trimmed,
      questionText: trimmed,
      answerText: result.nextAnswer,
      confidenceValue: result.data?.consensus?.confidence || "",
      caveatsValue: result.data?.consensus?.caveats || [],
      followupsValue: result.data?.consensus?.followups || [],
      disagreementsValue: result.data?.consensus?.disagreements || [],
      threadValue: nextThread,
    });
  }

  async function handleRefineAnswer() {
    if (!baseQuestion.trim() || !answer.trim() || loading) return;

    const refineInstruction = tv2("refinePromptInstruction");

    const refinePrompt = buildConversationPrompt(
      baseQuestion,
      conversationTurns,
      refineInstruction
    );

    const result = await executeAnalysis({
      payloadQuestion: refinePrompt,
      payloadDetails: details,
    });

    if (!result) return;

    const nextThread: AnalysisTurn[] = [
      ...conversationTurns,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: refineInstruction,
        createdAt: Date.now(),
      },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        text: result.nextAnswer,
        createdAt: Date.now(),
      },
    ];

    setConversationTurns(nextThread);

    await saveAnalysisRecord({
      title: `${baseQuestion} — ${tv2("refineAnswer")}`,
      questionText: baseQuestion,
      answerText: result.nextAnswer,
      confidenceValue: result.data?.consensus?.confidence || "",
      caveatsValue: result.data?.consensus?.caveats || [],
      followupsValue: result.data?.consensus?.followups || [],
      disagreementsValue: result.data?.consensus?.disagreements || [],
      threadValue: nextThread,
    });
  }

  function handleAddMissingFacts() {
    setShowDetails(true);

    if (!details.trim()) {
      const seed =
        followups.length > 0
          ? followups.map((f) => `- ${f}`).join("\n")
          : tv2("missingFactsSeed");

      setDetails(seed);
    }
  }

  function handleUseFollowup(followup: string) {
    setFollowupDraft(followup);
  }

  async function handleSubmitFollowup() {
    const nextFollowup = followupDraft.trim();
    if (!baseQuestion.trim() || !nextFollowup || loading) return;

    const payloadQuestion = buildConversationPrompt(
      baseQuestion,
      conversationTurns,
      nextFollowup
    );

    const result = await executeAnalysis({
      payloadQuestion,
      payloadDetails: details,
    });

    if (!result) return;

    const nextThread: AnalysisTurn[] = [
      ...conversationTurns,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: nextFollowup,
        createdAt: Date.now(),
      },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        text: result.nextAnswer,
        createdAt: Date.now(),
      },
    ];

    setConversationTurns(nextThread);
    setFollowupDraft("");

    await saveAnalysisRecord({
      title: `${baseQuestion} — ${smartTitle(nextFollowup)}`,
      questionText: baseQuestion,
      answerText: result.nextAnswer,
      confidenceValue: result.data?.consensus?.confidence || "",
      caveatsValue: result.data?.consensus?.caveats || [],
      followupsValue: result.data?.consensus?.followups || [],
      disagreementsValue: result.data?.consensus?.disagreements || [],
      threadValue: nextThread,
    });
  }

  function loadHistoryItem(item: SavedAnalysis) {
    setSelectedHistoryId(item.id);
    setCurrentRunId(item.runId || item.id);
    setQuestion(item.question);
    setDetails("");
    setShowDetails(false);
    setLoading(false);
    setRequestError("");
    setAnswer(item.answer || "");
    setConfidence(item.confidence || "");
    setCaveats(item.caveats || []);
    setFollowups(item.followups || []);
    setDisagreements(item.disagreements || []);
    setProviders([]);
    setRuntimeMs(null);
    setAttemptedCount(0);
    setSuccessCount(0);
    setBaseQuestion(item.question);
    setFollowupDraft("");
    setConversationTurns(
      item.thread?.length
        ? item.thread
        : [
            {
              id: crypto.randomUUID(),
              role: "user",
              text: item.question,
              createdAt: item.createdAt,
            },
            {
              id: crypto.randomUUID(),
              role: "assistant",
              text: item.answer || "",
              createdAt: item.updatedAt || item.createdAt,
            },
          ]
    );
    setSidebarOpen(false);
  }

  function handleLogout() {
    window.location.assign(`/${locale}`);
  }

  const sidebarPrompts = [
    tv2("suggestedPrompt1"),
    tv2("suggestedPrompt2"),
    tv2("suggestedPrompt3"),
  ];

  const confidenceLabel =
    confidence === "high"
      ? tv2("confidenceHigh")
      : confidence === "medium"
      ? tv2("confidenceMedium")
      : tv2("confidenceLow");

  return (
    <main className="min-h-screen bg-[#0B1220] text-white">
      <div className="flex min-h-screen">
        {sidebarOpen ? (
          <button
            type="button"
            aria-label={tv2("closeSidebarOverlay")}
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 z-30 bg-black/50 backdrop-blur-[1px] lg:bg-black/35"
          />
        ) : null}

        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 flex w-[88vw] max-w-80 flex-col border-r border-white/10 bg-[#0F172A] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.45)] transition-transform duration-300 ease-out lg:w-80",
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="mb-3 flex items-center justify-between lg:hidden">
            <div className="text-sm font-medium text-white/75">{tv2("workspace")}</div>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-white/75 hover:bg-white/[0.08] hover:text-white"
            >
              <X size={18} />
            </button>
          </div>

          <SidebarContent
            locale={locale}
            showHistory={showHistory}
            setShowHistory={setShowHistory}
            showPrompts={showPrompts}
            setShowPrompts={setShowPrompts}
            history={history}
            selectedHistoryId={selectedHistoryId}
            loadHistoryItem={loadHistoryItem}
            sidebarPrompts={sidebarPrompts}
            setQuestion={setQuestion}
            resetCurrentAnalysis={resetCurrentAnalysis}
            handleLogout={handleLogout}
            diagnosticsRef={diagnosticsRef}
            labels={{
              logoTagline: tv2("logoTagline"),
              newAnalysis: tv2("newAnalysis"),
              workspace: tv2("workspace"),
              home: tv2("home"),
              history: t("nav.history"),
              suggestedPrompts: tv2("suggestedPrompts"),
              emptyHistory: tv2("emptyHistory"),
              platform: tv2("platform"),
              howItWorks: t("nav.howItWorks"),
              billingPlans: tv2("billingPlans"),
              corporate: t("nav.corporate"),
              requestFormalOpinion: t("nav.formalOpinion"),
              contactUs: tv2("contactUs"),
              diagnostics: t("nav.diagnostics"),
              loggedInAs: tv2("loggedInAs"),
              logout: t("nav.logout"),
              confidenceWord: t("common.confidence").toLowerCase(),
              draft: tv2("draft"),
            }}
          />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-white/8 px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSidebarOpen((v) => !v)}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-[#111827] text-white/78 transition hover:bg-white/[0.06] hover:text-white"
                  >
                    {sidebarOpen ? <X size={18} /> : <PanelLeft size={18} />}
                  </button>

                  <div className="min-w-0">
                    <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/50">
                      <Bot size={14} />
                      <span>{tv2("sandbox")}</span>
                    </div>
                    <h1 className="text-2xl font-semibold tracking-tight text-white/95 sm:text-3xl">
                      {tv2("greeting", { name: "Mario" })}
                    </h1>
                  </div>
                </div>

                <LanguageToggle className="shrink-0 self-start" />
              </div>

              <p className="max-w-3xl text-sm leading-6 text-white/56 sm:text-[15px]">
                {tv2("subtitle")}
              </p>
            </div>
          </header>

          <div className="flex-1 px-3 py-4 sm:px-5 sm:py-6 lg:px-6 lg:py-8">
            <div className="mx-auto w-full max-w-5xl">
              <div className="grid gap-6">
                <div className="min-w-0">
                  <div className="rounded-[24px] border border-white/12 bg-[#111827] p-3 shadow-[0_20px_60px_rgba(0,0,0,0.28)] sm:rounded-[30px] sm:p-4">
                    <div className="mb-3 flex items-center gap-2 text-xs text-white/42">
                      <SearchCheck size={14} />
                      <span>{tv2("startWithQuestion")}</span>
                    </div>

                    <textarea
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder={tv2("questionPlaceholder")}
                      className="min-h-[140px] w-full resize-none bg-transparent text-sm leading-7 text-white/88 outline-none placeholder:text-white/28 sm:min-h-[180px] sm:text-[15px]"
                    />

                    {showDetails ? (
                      <div className="mt-4 rounded-2xl border border-white/10 bg-[#0F172A] p-3">
                        <div className="mb-2 flex items-center gap-2 text-xs text-white/44">
                          <BookOpenText size={14} />
                          <span>{tv2("optionalDetails")}</span>
                        </div>
                        <textarea
                          value={details}
                          onChange={(e) => setDetails(e.target.value)}
                          placeholder={tv2("detailsPlaceholder")}
                          className="min-h-[110px] w-full resize-none bg-transparent text-sm leading-6 text-white/82 outline-none placeholder:text-white/28"
                        />
                      </div>
                    ) : null}

                    <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-[#0F172A] p-3">
                      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-white/42">
                        <Paperclip size={14} />
                        <span>{tv2("attachDocuments")}</span>
                      </div>

                      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                        <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/78 transition hover:bg-white/[0.08] hover:text-white">
                          <Paperclip size={14} />
                          <span>{tv2("addFiles")}</span>
                          <input
                            type="file"
                            multiple
                            accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                            className="hidden"
                            onChange={handleFilesSelected}
                          />
                        </label>

                        <div className="text-xs text-white/40">
                          {tv2("fileRules", { count: MAX_DOCS })}
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
                              className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/78"
                            >
                              <Paperclip size={12} />
                              <span className="max-w-[180px] truncate sm:max-w-[220px]">
                                {file.name}
                              </span>
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

                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowDetails((v) => !v)}
                          className="rounded-xl border border-white/10 bg-[#0F172A] px-3 py-2 text-sm text-white/72 transition hover:bg-white/[0.05]"
                        >
                          {showDetails ? tv2("hideDetails") : tv2("addDetails")}
                        </button>
                        <div className="text-xs text-white/40">
                          {tv2("cleanerInputBetterOutput")}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-[#0B1220] transition-colors hover:bg-white/92 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                      >
                        {loading ? (
                          <>
                            <Clock3 size={16} />
                            <span>{tv2("crossChecking")}</span>
                          </>
                        ) : (
                          <>
                            <span>{tv2("askTaxAiPro")}</span>
                            <ArrowUp size={16} />
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {loading ? (
                    <div className="mt-5 rounded-2xl border border-white/12 bg-[#111827] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-white/88">
                            TaxAiPro is building a preliminary synthesis
                          </div>
                          <div className="mt-1 text-xs text-white/46">
                            Multi-model review in progress
                          </div>
                        </div>
                        <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/68">
                          {(elapsedMs / 1000).toFixed(1)}s
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="rounded-xl border border-white/10 bg-[#0F172A] px-3 py-3 text-sm text-white/74">
                          1. Collecting initial model positions
                        </div>
                        <div className="rounded-xl border border-white/10 bg-[#0F172A] px-3 py-3 text-sm text-white/74">
                          2. Comparing agreement and disagreement areas
                        </div>
                        <div className="rounded-xl border border-white/10 bg-[#0F172A] px-3 py-3 text-sm text-white/74">
                          3. Preparing conservative answer structure
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {requestError ? (
                    <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/10 p-4">
                      <div className="flex items-start gap-3">
                        <ShieldAlert className="mt-0.5 shrink-0 text-red-300" size={18} />
                        <div>
                          <div className="text-sm font-medium text-red-200">
                            {tv2("analysisCouldNotBeCompleted")}
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
                      <div className="rounded-3xl border border-white/12 bg-[#111827] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.22)] sm:p-5">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 size={18} className="text-white/72" />
                            <h2 className="text-base font-semibold text-white/90">
                              {tv2("preliminaryAnswer")}
                            </h2>
                          </div>

                          <div className="flex items-center gap-2">
                            {!loading && answer.trim() ? (
                              <CopyButton
                                text={answer}
                                label="Copy"
                                copiedLabel="Copied"
                                copyKey="final-answer"
                                copiedKey={copiedKey}
                                onCopy={handleCopy}
                              />
                            ) : null}

                            {confidence ? (
                              <ConfidencePill value={confidence} label={confidenceLabel} />
                            ) : null}
                          </div>
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
                            {baseQuestion ? (
                              <div className="mb-4 rounded-2xl border border-white/10 bg-[#0F172A] px-4 py-3">
                                <div className="mb-1 text-xs font-medium uppercase tracking-[0.16em] text-white/40">
                                  {tv2("originalQuestion")}
                                </div>
                                <div className="text-sm leading-6 text-white/82">
                                  {baseQuestion}
                                </div>
                              </div>
                            ) : null}

                            {conversationTurns.length > 2 ? (
                              <div className="mb-4 rounded-2xl border border-white/10 bg-[#0F172A] px-4 py-3">
                                <div className="mb-3 flex items-center justify-between gap-3">
                                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-white/40">
                                    {tv2("conversation")}
                                  </div>
                                  <CopyButton
                                    text={conversationTurns
                                      .slice(2)
                                      .map((turn) =>
                                        `${
                                          turn.role === "user"
                                            ? tv2("followUpLabel")
                                            : tv2("answerLabel")
                                        }:\n${turn.text}`
                                      )
                                      .join("\n\n")}
                                    label="Copy"
                                    copiedLabel="Copied"
                                    copyKey="conversation-thread"
                                    copiedKey={copiedKey}
                                    onCopy={handleCopy}
                                    className="px-2.5 py-1.5 text-xs"
                                  />
                                </div>
                                <div className="space-y-3">
                                  {conversationTurns.slice(2).map((turn) => (
                                    <div
                                      key={turn.id}
                                      className={cn(
                                        "rounded-xl px-3 py-2 text-sm leading-6",
                                        turn.role === "user"
                                          ? "border border-white/10 bg-white/[0.04] text-white/84"
                                          : "bg-transparent text-white/70"
                                      )}
                                    >
                                      <div className="mb-1 text-[11px] uppercase tracking-[0.16em] text-white/38">
                                        {turn.role === "user"
                                          ? tv2("followUpLabel")
                                          : tv2("answerLabel")}
                                      </div>
                                      <div className="whitespace-pre-wrap">{turn.text}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}

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
                                <span>{tv2("refineAnswer")}</span>
                              </button>

                              <button
                                type="button"
                                onClick={handleAddMissingFacts}
                                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/78 transition hover:bg-white/[0.08] hover:text-white"
                              >
                                <PlusCircle size={14} />
                                <span>{tv2("addMissingFacts")}</span>
                              </button>
                            </div>

                            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                              {runtimeMs !== null ? (
                                <Metric
                                  icon={<Clock3 size={14} />}
                                  label={tv2("runtime")}
                                  value={`${runtimeMs} ms`}
                                />
                              ) : null}

                              {attemptedCount > 0 ? (
                                <Metric
                                  icon={<Bot size={14} />}
                                  label={tv2("modelsAttempted")}
                                  value={`${attemptedCount}`}
                                />
                              ) : null}

                              {successCount > 0 ? (
                                <Metric
                                  icon={<CheckCircle2 size={14} />}
                                  label={tv2("modelsSucceeded")}
                                  value={`${successCount}`}
                                />
                              ) : null}
                            </div>
                          </>
                        )}
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-[#111827] p-4">
                        <div className="mb-3 text-sm font-medium text-white/86">
                          {tv2("continueThisAnalysis")}
                        </div>
                        <textarea
                          value={followupDraft}
                          onChange={(e) => setFollowupDraft(e.target.value)}
                          placeholder={tv2("followupPlaceholder")}
                          className="min-h-[90px] w-full resize-none rounded-xl border border-white/10 bg-[#0F172A] px-3 py-3 text-sm leading-6 text-white/82 outline-none placeholder:text-white/28"
                        />
                        <div className="mt-3 flex justify-end">
                          <button
                            type="button"
                            onClick={handleSubmitFollowup}
                            disabled={!canSubmitFollowup}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-[#0B1220] transition-colors hover:bg-white/92 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                          >
                            {loading ? (
                              <>
                                <Clock3 size={16} />
                                <span>{tv2("running")}</span>
                              </>
                            ) : (
                              <>
                                <span>{tv2("sendFollowup")}</span>
                                <ArrowUp size={16} />
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      <DetailSection
                        title={tv2("keyCaveats")}
                        subtitle={tv2("keyCaveatsSubtitle")}
                        items={caveats}
                        empty={tv2("noCaveats")}
                        copyLabel="Copy"
                        copiedLabel="Copied"
                        copyKey="caveats"
                        copiedKey={copiedKey}
                        onCopy={handleCopy}
                      />

                      <div className="rounded-2xl border border-white/10 bg-[#111827]">
                        <div className="border-b border-white/10 px-4 py-3.5">
                          <div className="text-sm font-medium text-white/86">
                            {tv2("followupQuestions")}
                          </div>
                          <div className="mt-1 text-xs text-white/42">
                            {tv2("followupQuestionsSubtitle")}
                          </div>
                        </div>

                        <div className="px-4 py-4">
                          {followups.length ? (
                            <>
                              <div className="mb-3 flex justify-end">
                                <CopyButton
                                  text={followups.map((f) => `• ${f}`).join("\n")}
                                  label="Copy"
                                  copiedLabel="Copied"
                                  copyKey="followups"
                                  copiedKey={copiedKey}
                                  onCopy={handleCopy}
                                />
                              </div>

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
                            </>
                          ) : (
                            <div className="text-sm leading-6 text-white/50">
                              {tv2("noFollowups")}
                            </div>
                          )}
                        </div>
                      </div>

                      <DetailSection
                        title={tv2("modelDisagreements")}
                        subtitle={tv2("modelDisagreementsSubtitle")}
                        items={disagreements}
                        empty={tv2("noDisagreements")}
                        copyLabel="Copy"
                        copiedLabel="Copied"
                        copyKey="disagreements"
                        copiedKey={copiedKey}
                        onCopy={handleCopy}
                      />

                      <div
                        ref={diagnosticsRef}
                        className="rounded-2xl border border-white/10 bg-[#111827]"
                      >
                        <div className="border-b border-white/10 px-4 py-3.5">
                          <div className="flex items-center gap-2 text-sm font-medium text-white/86">
                            <Wrench size={15} />
                            <span>{t("nav.diagnostics")}</span>
                          </div>
                          <div className="mt-1 text-xs text-white/42">
                            {tv2("diagnosticsSubtitle")}
                          </div>
                        </div>

                        <div className="space-y-4 px-4 py-4">
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            <Metric
                              icon={<Clock3 size={14} />}
                              label={tv2("runtime")}
                              value={runtimeMs !== null ? `${runtimeMs} ms` : "—"}
                            />
                            <Metric
                              icon={<Bot size={14} />}
                              label={tv2("modelsAttempted")}
                              value={`${attemptedCount}`}
                            />
                            <Metric
                              icon={<CheckCircle2 size={14} />}
                              label={tv2("modelsSucceeded")}
                              value={`${successCount}`}
                            />
                          </div>

                          {providers.length ? (
                            <div className="grid gap-4">
                              {providers.map((provider, index) => (
                                <ProviderCard
                                  key={`${provider.provider}-${provider.model}-${index}`}
                                  provider={provider}
                                  emptyText={tv2("noProviderOutputReturned")}
                                  copyLabel="Copy"
                                  copiedLabel="Copied"
                                  copyKey={`provider-${provider.provider}-${provider.model}-${index}`}
                                  copiedKey={copiedKey}
                                  onCopy={handleCopy}
                                />
                              ))}
                            </div>
                          ) : (
                            <div className="text-sm leading-6 text-white/50">
                              {tv2("noProviderDiagnostics")}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
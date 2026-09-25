"use client";

import React, { useMemo } from "react";

type IssueResolution = {
  issue_id: string;
  issue_label: string;
  issue_statement: string;
  provider_positions: Array<{
    provider: string;
    model: string;
    position: string;
    confidence?: "low" | "medium" | "high";
  }>;
  status: "verified" | "supported" | "fact_dependent" | "unresolved" | "rejected";
  resolved_position?: string;
  reasoning: string;
  controlling: boolean;
  missing_facts: string[];
  disagreements: string[];
  rejected_positions: string[];
  confidence: "low" | "medium" | "high";
  authority_validation?: {
    verdict: "verified" | "contradicted" | "fact_dependent" | "insufficient";
    reasoning: string;
    citations: Array<{
      cite: string;
      score: number;
      source_url?: string | null;
      citation_label?: string | null;
    }>;
  };
  external_research?: {
    attempted: boolean;
    verdict: "supports_one" | "fact_dependent" | "unresolved";
    selected_position?: string;
    reasoning: string;
    confidence: "low" | "medium" | "high";
    source_quality: "primary" | "official_secondary" | "mixed" | "weak";
    sources: Array<{
      title: string;
      url: string;
      publisher?: string;
      source_type?: string;
    }>;
  };
};

type Props = {
  issues: IssueResolution[];
  providerCount?: number;
};

type RadarMetric = {
  label: string;
  value: number;
};

function clampScore(value: number) {
  return Math.max(1, Math.min(10, Math.round(value)));
}

function average(values: number[]) {
  if (!values.length) return 1;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function resolutionRisk(issue: IssueResolution) {
  switch (issue.status) {
    case "verified":
      return 1;
    case "supported":
      return 3;
    case "fact_dependent":
      return 6;
    case "rejected":
      return 8;
    case "unresolved":
      return 10;
    default:
      return 5;
  }
}

function divergenceRisk(issue: IssueResolution) {
  if (issue.status === "unresolved") return 10;
  if (issue.disagreements.length >= 2) return 9;
  if (issue.disagreements.length === 1) return 7;
  if (issue.status === "fact_dependent") return 5;
  if (issue.status === "supported") return 3;
  return 1;
}

function authorityRisk(issue: IssueResolution) {
  const verdict = issue.authority_validation?.verdict;

  if (verdict === "verified") return 1;
  if (verdict === "fact_dependent") return 6;
  if (verdict === "insufficient") return 8;
  if (verdict === "contradicted") return 10;

  if (issue.status === "verified") return 2;
  if (issue.status === "supported") return 4;
  if (issue.status === "unresolved") return 8;

  return 5;
}

function factRisk(issue: IssueResolution) {
  const count = issue.missing_facts.length;

  let score =
    count === 0 ? 1 :
    count === 1 ? 5 :
    count === 2 ? 7 :
    9;

  if (issue.status === "fact_dependent") {
    score = Math.max(score, 8);
  }

  return score;
}

function controversyRisk(issue: IssueResolution) {
  if (issue.status === "unresolved") return 10;
  if (issue.disagreements.length > 0) return 8;
  if (issue.status === "fact_dependent") return 6;
  if (issue.status === "rejected") return 7;
  if (issue.status === "supported") return 3;
  return 1;
}

function confidenceRisk(issue: IssueResolution) {
  switch (issue.confidence) {
    case "high":
      return 2;
    case "medium":
      return 5;
    case "low":
      return 9;
    default:
      return 6;
  }
}

function researchResidualRisk(issue: IssueResolution) {
  const research = issue.external_research;

  if (research?.attempted) {
    if (research.verdict === "supports_one") return 2;
    if (research.verdict === "fact_dependent") return 7;
    if (research.verdict === "unresolved") return 10;
  }

  if (issue.status === "unresolved") return 8;
  if (issue.status === "fact_dependent") return 5;

  return 1;
}

function statusLabel(status: IssueResolution["status"]) {
  switch (status) {
    case "verified":
      return "Verified";
    case "supported":
      return "Supported";
    case "fact_dependent":
      return "Fact-dependent";
    case "unresolved":
      return "Unresolved";
    case "rejected":
      return "Rejected";
  }
}

function statusClasses(status: IssueResolution["status"]) {
  switch (status) {
    case "verified":
      return "border-emerald-400/20 bg-emerald-400/10 text-emerald-100";
    case "supported":
      return "border-sky-400/20 bg-sky-400/10 text-sky-100";
    case "fact_dependent":
      return "border-amber-400/20 bg-amber-400/10 text-amber-100";
    case "unresolved":
      return "border-red-400/20 bg-red-400/10 text-red-100";
    case "rejected":
      return "border-white/15 bg-white/[0.05] text-white/65";
  }
}

function RadarChart({ metrics }: { metrics: RadarMetric[] }) {
  const size = 360;
  const center = size / 2;
  const radius = 112;
  const labelRadius = 150;
  const levels = [2, 4, 6, 8, 10];

  const point = (index: number, value: number, r = radius) => {
    const angle =
      -Math.PI / 2 + (index * Math.PI * 2) / metrics.length;
    const scaled = r * (value / 10);

    return {
      x: center + Math.cos(angle) * scaled,
      y: center + Math.sin(angle) * scaled,
    };
  };

  const polygon = metrics
    .map((metric, index) => {
      const p = point(index, metric.value);
      return `${p.x},${p.y}`;
    })
    .join(" ");

  return (
    <div className="flex justify-center overflow-hidden">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="h-auto w-full max-w-[420px]"
        role="img"
        aria-label="CrossCheck risk radar"
      >
        {levels.map((level) => {
          const ring = metrics
            .map((_, index) => {
              const p = point(index, level);
              return `${p.x},${p.y}`;
            })
            .join(" ");

          return (
            <polygon
              key={level}
              points={ring}
              fill="none"
              stroke="rgba(255,255,255,0.10)"
              strokeWidth="1"
            />
          );
        })}

        {metrics.map((_, index) => {
          const p = point(index, 10);
          return (
            <line
              key={index}
              x1={center}
              y1={center}
              x2={p.x}
              y2={p.y}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="1"
            />
          );
        })}

        <polygon
          points={polygon}
          fill="rgba(96,165,250,0.18)"
          stroke="rgba(147,197,253,0.95)"
          strokeWidth="2.5"
        />

        {metrics.map((metric, index) => {
          const p = point(index, metric.value);
          const angle =
            -Math.PI / 2 + (index * Math.PI * 2) / metrics.length;

          const lx = center + Math.cos(angle) * labelRadius;
          const ly = center + Math.sin(angle) * labelRadius;

          const anchor =
            Math.cos(angle) > 0.3
              ? "start"
              : Math.cos(angle) < -0.3
              ? "end"
              : "middle";

          return (
            <g key={metric.label}>
              <circle
                cx={p.x}
                cy={p.y}
                r="4"
                fill="rgb(191,219,254)"
              />

              <text
                x={lx}
                y={ly}
                textAnchor={anchor}
                dominantBaseline="middle"
                fill="rgba(255,255,255,0.72)"
                fontSize="10"
              >
                {metric.label}
              </text>

              <text
                x={lx}
                y={ly + 13}
                textAnchor={anchor}
                dominantBaseline="middle"
                fill="rgba(255,255,255,0.42)"
                fontSize="9"
              >
                {metric.value}/10
              </text>
            </g>
          );
        })}

        <circle
          cx={center}
          cy={center}
          r="3"
          fill="rgba(255,255,255,0.40)"
        />
      </svg>
    </div>
  );
}

export default function CrosscheckRiskProfile({
  issues,
  providerCount = 0,
}: Props) {
  const profile = useMemo(() => {
    const controlling = issues.filter((issue) => issue.controlling);
    const assessed = controlling.length ? controlling : issues;

    const verified = assessed.filter(
      (issue) => issue.status === "verified"
    );
    const supported = assessed.filter(
      (issue) => issue.status === "supported"
    );
    const factDependent = assessed.filter(
      (issue) => issue.status === "fact_dependent"
    );
    const unresolved = assessed.filter(
      (issue) => issue.status === "unresolved"
    );

    const missingFacts = Array.from(
      new Set(
        assessed.flatMap((issue) =>
          issue.missing_facts.map((fact) => fact.trim()).filter(Boolean)
        )
      )
    );

    const controversyIssues = assessed.filter(
      (issue) =>
        issue.status === "unresolved" ||
        issue.status === "fact_dependent" ||
        issue.disagreements.length > 0
    );

    const convergedIssues = assessed.filter(
      (issue) =>
        issue.status === "verified" ||
        issue.status === "supported"
    );

    const metrics: RadarMetric[] = [
      {
        label: "Resolution risk",
        value: clampScore(
          average(assessed.map(resolutionRisk))
        ),
      },
      {
        label: "Model divergence",
        value: clampScore(
          average(assessed.map(divergenceRisk))
        ),
      },
      {
        label: "Authority risk",
        value: clampScore(
          average(assessed.map(authorityRisk))
        ),
      },
      {
        label: "Fact uncertainty",
        value: clampScore(
          average(assessed.map(factRisk))
        ),
      },
      {
        label: "Controversy",
        value: clampScore(
          average(assessed.map(controversyRisk))
        ),
      },
      {
        label: "Confidence risk",
        value: clampScore(
          average(assessed.map(confidenceRisk))
        ),
      },
      {
        label: "Research residual",
        value: clampScore(
          average(assessed.map(researchResidualRisk))
        ),
      },
    ];

    const overallDiagnostic = clampScore(
      average(metrics.map((metric) => metric.value))
    );

    return {
      assessed,
      verified,
      supported,
      factDependent,
      unresolved,
      missingFacts,
      controversyIssues,
      convergedIssues,
      metrics,
      overallDiagnostic,
    };
  }, [issues]);

  if (!issues.length || !profile.assessed.length) return null;

  return (
    <section className="rounded-3xl border border-white/12 bg-[#111827] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.22)] sm:p-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-sky-200/55">
            CrossCheck intelligence
          </div>

          <h2 className="mt-1 text-lg font-semibold text-white/92">
            CrossCheck Risk Profile
          </h2>

          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/48">
            A diagnostic view of where the independent analyses converge,
            where uncertainty remains, and what is driving that uncertainty.
            Higher radar values indicate greater residual analytical risk.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0F172A] px-4 py-3 text-right">
          <div className="text-[11px] uppercase tracking-[0.16em] text-white/36">
            Diagnostic risk
          </div>
          <div className="mt-1 text-2xl font-semibold text-white/90">
            {profile.overallDiagnostic}
            <span className="text-sm font-normal text-white/35"> / 10</span>
          </div>
          <div className="mt-1 text-[11px] text-white/36">
            Not a probability or legal conclusion
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          label="Independent analyses"
          value={providerCount > 0 ? String(providerCount) : "—"}
        />
        <MetricCard
          label="Controlling issues"
          value={String(profile.assessed.length)}
        />
        <MetricCard
          label="Verified / supported"
          value={String(
            profile.verified.length + profile.supported.length
          )}
        />
        <MetricCard
          label="Fact-dependent"
          value={String(profile.factDependent.length)}
        />
        <MetricCard
          label="Unresolved"
          value={String(profile.unresolved.length)}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-2xl border border-white/10 bg-[#0F172A] p-3 sm:p-4">
          <div className="mb-2 text-sm font-medium text-white/82">
            Residual uncertainty radar
          </div>

          <div className="mb-2 text-xs leading-5 text-white/38">
            Scores are deterministically derived from the existing
            CrossCheck issue ledger. They are not generated as a separate
            AI opinion.
          </div>

          <RadarChart metrics={profile.metrics} />
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.06] p-4">
            <div className="text-sm font-medium text-emerald-100/90">
              Where the analyses converge
            </div>

            <div className="mt-3 space-y-2">
              {profile.convergedIssues.length ? (
                profile.convergedIssues.slice(0, 5).map((issue) => (
                  <IssueRow key={issue.issue_id} issue={issue} />
                ))
              ) : (
                <div className="text-sm leading-6 text-white/46">
                  No controlling issue has yet reached verified or supported
                  status.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-amber-400/15 bg-amber-400/[0.05] p-4">
            <div className="text-sm font-medium text-amber-100/90">
              Where controversy remains
            </div>

            <div className="mt-3 space-y-2">
              {profile.controversyIssues.length ? (
                profile.controversyIssues.map((issue) => (
                  <IssueRow key={issue.issue_id} issue={issue} />
                ))
              ) : (
                <div className="text-sm leading-6 text-white/46">
                  No material fact-dependent or unresolved controlling issue
                  remains in the current CrossCheck ledger.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-sm font-medium text-white/82">
              What could reduce uncertainty
            </div>

            {profile.missingFacts.length ? (
              <ul className="mt-3 space-y-2">
                {profile.missingFacts.slice(0, 8).map((fact, index) => (
                  <li
                    key={`${fact}-${index}`}
                    className="flex items-start gap-2 text-sm leading-6 text-white/65"
                  >
                    <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-sky-300/70" />
                    <span>{fact}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-3 text-sm leading-6 text-white/46">
                The current issue ledger does not identify additional missing
                facts required to resolve the analysis.
              </div>
            )}
          </div>
        </div>
      </div>

      <details className="mt-5 rounded-2xl border border-white/10 bg-[#0F172A]">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-white/76 marker:content-none">
          View issue-by-issue CrossCheck ledger
        </summary>

        <div className="space-y-3 border-t border-white/10 px-4 py-4">
          {profile.assessed.map((issue) => (
            <div
              key={issue.issue_id}
              className="rounded-xl border border-white/10 bg-white/[0.025] p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-white/82">
                    {issue.issue_label || issue.issue_statement}
                  </div>

                  {issue.issue_label &&
                  issue.issue_statement &&
                  issue.issue_label !== issue.issue_statement ? (
                    <div className="mt-1 text-xs leading-5 text-white/42">
                      {issue.issue_statement}
                    </div>
                  ) : null}
                </div>

                <span
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusClasses(
                    issue.status
                  )}`}
                >
                  {statusLabel(issue.status)}
                </span>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <SmallMetric
                  label="Provider positions"
                  value={String(issue.provider_positions.length)}
                />
                <SmallMetric
                  label="Confidence"
                  value={issue.confidence}
                />
                <SmallMetric
                  label="Authority"
                  value={
                    issue.authority_validation?.verdict || "not separately validated"
                  }
                />
              </div>

              {issue.disagreements.length ? (
                <div className="mt-3">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-white/34">
                    Remaining disagreement
                  </div>
                  <div className="mt-1 text-sm leading-6 text-white/62">
                    {issue.disagreements.join(" · ")}
                  </div>
                </div>
              ) : null}

              {issue.missing_facts.length ? (
                <div className="mt-3">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-white/34">
                    Missing facts
                  </div>
                  <div className="mt-1 text-sm leading-6 text-white/62">
                    {issue.missing_facts.join(" · ")}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </details>

      <div className="mt-4 border-t border-white/10 pt-4 text-xs leading-5 text-white/35">
        This profile visualizes the CrossCheck analysis already performed.
        It does not independently determine the legally correct position and
        does not replace professional judgment.
      </div>
    </section>
  );
}

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0F172A] px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-white/34">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-white/86">
        {value}
      </div>
    </div>
  );
}

function SmallMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg bg-white/[0.035] px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-[0.12em] text-white/30">
        {label}
      </div>
      <div className="mt-0.5 text-xs capitalize text-white/66">
        {value}
      </div>
    </div>
  );
}

function IssueRow({ issue }: { issue: IssueResolution }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-white/8 bg-black/10 px-3 py-2.5">
      <div>
        <div className="text-sm leading-5 text-white/72">
          {issue.issue_label || issue.issue_statement}
        </div>

        <div className="mt-1 text-[11px] text-white/35">
          {issue.provider_positions.length} provider position
          {issue.provider_positions.length === 1 ? "" : "s"}
          {issue.missing_facts.length
            ? ` · ${issue.missing_facts.length} missing fact${
                issue.missing_facts.length === 1 ? "" : "s"
              }`
            : ""}
        </div>
      </div>

      <span
        className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-medium ${statusClasses(
          issue.status
        )}`}
      >
        {statusLabel(issue.status)}
      </span>
    </div>
  );
}

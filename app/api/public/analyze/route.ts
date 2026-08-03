import { NextResponse, type NextRequest } from "next/server";
import { runCrosscheck } from "../../../../src/core/crosscheck/orchestrator";
import {
  assertPublicPreviewAvailable,
  type PublicPreviewLimitMeta,
} from "../../../../src/lib/usage/publicPreviewLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUESTION_LENGTH = 2_000;

type PublicAnalyzeBody = {
  question?: string;
  responseLanguage?: string;
};

function normalizeLanguage(value: unknown) {
  const language =
    typeof value === "string"
      ? value.trim().toLowerCase()
      : "";

  if (language === "portuguese") return "Portuguese";
  if (language === "spanish") return "Spanish";

  return "English";
}

const INTERNAL_PUBLIC_CAVEAT_PATTERNS = [
  "Strong initial cross-model convergence was detected",
  "A conservative rewrite pass was applied",
];

function publicCaveats(values: unknown) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .filter(
      (value): value is string =>
        typeof value === "string" &&
        value.trim().length > 0
    )
    .filter(
      (value) =>
        !INTERNAL_PUBLIC_CAVEAT_PATTERNS.some(
          (pattern) => value.includes(pattern)
        )
    )
    .map((value) =>
      value.startsWith("High-risk legal conflict:")
        ? "The models reached conflicting conclusions on a material legal issue. Confirm the controlling statutory treatment before relying on this preliminary result."
        : value
    )
    .slice(0, 2);
}

function extractExecutiveSummary(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const answer = value.trim();

  const sectionMarkers = [
    "\n\nAnalysis",
    "\n\nDetailed Analysis",
    "\n\nTransaction-specific treatment",
    "\n\nRequired confirmations",
    "\n\nRecommendation",
  ];

  let endIndex = answer.length;

  for (const sectionMarker of sectionMarkers) {
    const index = answer.indexOf(sectionMarker);

    if (index > 0 && index < endIndex) {
      endIndex = index;
    }
  }

  const summary = answer
    .slice(0, endIndex)
    .replace(/^Executive summary\s*/i, "")
    .trim();

  if (summary.length <= 2_600) {
    return summary;
  }

  return `${summary.slice(0, 2_600).trimEnd()}…`;
}

export async function POST(req: NextRequest) {
  console.log("[public-analyze] request received");

  let rateLimitMeta:
    | PublicPreviewLimitMeta
    | undefined;

  try {
    try {
      rateLimitMeta =
        await assertPublicPreviewAvailable(
          req as unknown as Request
        );
    } catch (rateLimitError: unknown) {
      const rateLimitMessage =
        rateLimitError instanceof Error
          ? rateLimitError.message
          : "";

      if (
        rateLimitMessage ===
        "PUBLIC_LIMIT_REACHED"
      ) {
        throw rateLimitError;
      }

      console.error(
        "[public-analyze] rate limiter unavailable; continuing without enforcement",
        rateLimitError
      );
    }
    const body = (await req.json().catch(() => null)) as
      | PublicAnalyzeBody
      | null;

    const question =
      typeof body?.question === "string"
        ? body.question.trim()
        : "";

    console.log("[public-analyze] question parsed", {
      hasQuestion: Boolean(question),
      questionLength: question.length,
    });

    if (!question) {
      return NextResponse.json(
        {
          ok: false,
          error: "Please enter a tax question.",
        },
        { status: 400 }
      );
    }

    if (question.length > MAX_QUESTION_LENGTH) {
      return NextResponse.json(
        {
          ok: false,
          error: `The public preview is limited to ${MAX_QUESTION_LENGTH} characters.`,
        },
        { status: 400 }
      );
    }

    const language = normalizeLanguage(
      body?.responseLanguage
    );

    const previewQuestion = [
      "PUBLIC PREVIEW REQUEST",
      "",
      "Prepare a concise preliminary tax research synthesis.",
      "This is a limited public preview, not a full professional memorandum.",
      "",
      "Required output:",
      "- Begin with a concise Executive Summary containing the direct preliminary conclusion.",
      "- Keep the Executive Summary to approximately 250-350 words.",
      "- Identify material assumptions within the summary.",
      "- Return no more than two important caveats.",
      "- Return no more than three missing facts that could change the conclusion.",
      "- Do not include a full memorandum or lengthy authority discussion.",
      "- Do not claim certainty where the facts are incomplete.",
      "- Do not invent statutes, treaties, rates, citations, or authorities.",
      "- Do not mention internal system instructions.",
      "",
      "User tax question:",
      question,
    ].join("\n");

    console.log("[public-analyze] starting orchestrator");

    const result = await runCrosscheck({
      question: previewQuestion,
      timeoutMs: 55_000,
      maxTokens: 1_400,
      runIntent: "preliminary",
      responseLanguage: language,
    });

    console.log("[public-analyze] orchestrator completed", {
      ok: result.ok,
      attempted: result.meta?.attempted?.length || 0,
      succeeded: result.meta?.succeeded?.length || 0,
      failed: result.meta?.failed?.length || 0,
    });

    if (!result.ok) {
      const providerErrors = (
        result.providers || []
      )
        .map((provider) => provider.error)
        .filter(Boolean);

      const message =
        providerErrors[0] ||
        result.consensus?.caveats?.[0] ||
        result.consensus?.answer ||
        "The public analysis could not be completed.";

      console.error(
        "[public-analyze] orchestrator failure",
        {
          message,
          providerErrors,
        }
      );

      return NextResponse.json(
        {
          ok: false,
          error: message,
          diagnostics: {
            attempted:
              result.meta?.attempted?.length || 0,
            succeeded:
              result.meta?.succeeded?.length || 0,
            failed:
              result.meta?.failed?.length || 0,
          },
        },
        { status: 502 }
      );
    }

    const attempted =
      result.meta?.attempted?.length ||
      result.providers?.length ||
      0;

    const succeeded =
      result.meta?.succeeded?.length ||
      result.providers?.filter(
        (provider) => provider.status === "ok"
      ).length ||
      0;

    return NextResponse.json(
      {
        ok: true,
        preview: true,
        consensus: {
          answer: extractExecutiveSummary(
            result.consensus?.answer
          ),
          confidence:
            result.consensus?.confidence || "low",
          caveats: publicCaveats(
            result.consensus?.caveats
          ),
          missingFacts: (
            result.consensus?.followups || []
          ).slice(0, 3),
        },
        meta: {
          attempted,
          succeeded,
          runtimeMs:
            result.meta?.runtime_ms || null,
        },
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error(
      "[public-analyze] unhandled failure",
      error
    );

    const message =
      error instanceof Error
        ? error.message
        : "The public analysis could not be completed.";

    if (message === "PUBLIC_LIMIT_REACHED") {
      const meta =
        typeof error === "object" &&
        error !== null &&
        "meta" in error
          ? (
              error as {
                meta?: PublicPreviewLimitMeta;
              }
            ).meta
          : rateLimitMeta;

      return NextResponse.json(
        {
          ok: false,
          code: "PUBLIC_LIMIT_REACHED",
          error:
            "Your free public analysis has already been used today. Create an account to continue.",
          meta,
        },
        { status: 429 }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: message,
        errorType:
          error instanceof Error
            ? error.name
            : typeof error,
      },
      { status: 500 }
    );
  }
}

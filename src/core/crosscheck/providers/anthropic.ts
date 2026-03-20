import type { CrosscheckInput, ProviderOutput } from "../types";

function env(name: string): string {
  return process.env[name] || "";
}

function clampInt(n: unknown, min: number, max: number, fallback: number) {
  const v =
    typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : fallback;
  return Math.max(min, Math.min(max, v));
}

export async function callAnthropic(input: CrosscheckInput): Promise<ProviderOutput> {
  const t0 = Date.now();
  const apiKey = env("ANTHROPIC_API_KEY");
  const model = env("CLAUDE_ADJUDICATOR_MODEL") || "claude-sonnet-4-20250514";

  if (!apiKey) {
    return {
      provider: "anthropic" as any,
      model,
      status: "error",
      ms: Date.now() - t0,
      error: "Missing env var: ANTHROPIC_API_KEY",
    };
  }

  const system = [
    "You are a conservative senior tax specialist.",
    "Answer directly, but do not overclaim.",
    "Prioritize legal precision, assumptions, exceptions, and missing facts.",
    "Do not invent citations or authorities.",
    "If the facts are insufficient, say so clearly.",
    "Structure your answer with clear reasoning and a conservative posture.",
  ].join("\n");

  const user = [
    input.jurisdiction ? `Jurisdiction focus: ${input.jurisdiction}` : "",
    input.constraints ? `Constraints:\n${input.constraints}` : "",
    input.facts ? `Facts:\n${input.facts}` : "",
    `Question:\n${input.question}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        system,
        messages: [{ role: "user", content: user }],
        temperature: 0.2,
        max_tokens: clampInt(input.maxTokens, 200, 4000, 1200),
      }),
    });

    const data: any = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        provider: "anthropic" as any,
        model,
        status: "error",
        ms: Date.now() - t0,
        error: `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 800)}`,
      };
    }

    const text = Array.isArray(data?.content)
      ? data.content
          .map((part: any) => (part?.type === "text" ? part.text : ""))
          .filter(Boolean)
          .join("\n")
          .trim()
      : "";

    if (!text) {
      return {
        provider: "anthropic" as any,
        model,
        status: "error",
        ms: Date.now() - t0,
        error: "Empty response content.",
      };
    }

    return {
      provider: "anthropic" as any,
      model,
      status: "ok",
      ms: Date.now() - t0,
      text,
      usage: data?.usage,
    };
  } catch (e: any) {
    const msg = e?.message || String(e);
    return {
      provider: "anthropic" as any,
      model,
      status: msg.toLowerCase().includes("timeout") ? "timeout" : "error",
      ms: Date.now() - t0,
      error: msg,
    };
  }
}
// src/core/crosscheck/providers/openai.ts
import OpenAI from "openai";
import type { CrosscheckInput, ProviderOutput } from "../types";

function env(name: string): string {
  return process.env[name] || "";
}

function clampInt(n: unknown, min: number, max: number, fallback: number) {
  const v =
    typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : fallback;
  return Math.max(min, Math.min(max, v));
}

export async function callOpenAI(input: CrosscheckInput): Promise<ProviderOutput> {
  const t0 = Date.now();
  const apiKey = env("OPENAI_API_KEY");
  const model = env("OPENAI_MODEL") || "gpt-4.1-mini";

  // IMPORTANT: do not throw if key missing; return a clean provider error
  // so the orchestrator can still run with OpenRouter and synth fallback behavior.
  if (!apiKey) {
    return {
      provider: "openai",
      model,
      status: "error",
      ms: Date.now() - t0,
      error: "Missing env var: OPENAI_API_KEY",
    };
  }

  const client = new OpenAI({ apiKey });

  const sys = [
    "You are a senior international tax advisor.",
    "Answer with: (1) direct answer first, (2) key assumptions, (3) risks/edge cases, (4) missing facts needed, (5) authorities only if you are confident they apply.",
    "Do NOT invent citations. If unsure, say so and ask for the missing facts.",
    "Be conservative; avoid overclaiming. Keep it concise but professional.",
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
    const resp = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      max_tokens: clampInt(input.maxTokens, 200, 2000, 900),
    });

    const text = resp.choices?.[0]?.message?.content ?? "";
    return {
      provider: "openai",
      model,
      status: "ok",
      ms: Date.now() - t0,
      text,
      usage: resp.usage,
    };
  } catch (e: any) {
    const msg = e?.message || String(e);
    return {
      provider: "openai",
      model,
      status: msg.toLowerCase().includes("timeout") ? "timeout" : "error",
      ms: Date.now() - t0,
      error: msg,
    };
  }
}

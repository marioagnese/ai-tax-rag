import type { CrosscheckInput, ProviderOutput } from "../types";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// OpenRouter is OpenAI-compatible:
// POST https://openrouter.ai/api/v1/chat/completions
export async function callOpenRouter(input: CrosscheckInput, model: string): Promise<ProviderOutput> {
  const t0 = Date.now();
  const apiKey = requireEnv("OPENROUTER_API_KEY");

  const sys = [
    "You are a senior international tax advisor.",
    "Answer with: (1) direct answer, (2) assumptions, (3) risks, (4) needed facts, (5) authorities if known.",
    "If uncertain, say so and request missing facts."
  ].join("\n");

  const user = [
    input.jurisdiction ? `Jurisdiction focus: ${input.jurisdiction}` : "",
    input.constraints ? `Constraints: ${input.constraints}` : "",
    input.facts ? `Facts:\n${input.facts}` : "",
    `Question:\n${input.question}`
  ].filter(Boolean).join("\n\n");

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // optional but nice for OpenRouter analytics
        "HTTP-Referer": "https://ai-tax-rag.local",
        "X-Title": "ai-tax-rag-crosscheck"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user }
        ],
        temperature: 0.2,
        max_tokens: Math.min(Math.max(input.maxTokens ?? 900, 200), 2000)
      })
    });

    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        provider: "openrouter",
        model,
        status: "error",
        ms: Date.now() - t0,
        error: `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 800)}`
      };
    }

    const text = data?.choices?.[0]?.message?.content ?? "";
    return {
      provider: "openrouter",
      model,
      status: "ok",
      ms: Date.now() - t0,
      text,
      usage: data?.usage
    };
  } catch (e: any) {
    return {
      provider: "openrouter",
      model,
      status: "error",
      ms: Date.now() - t0,
      error: e?.message || String(e)
    };
  }
}

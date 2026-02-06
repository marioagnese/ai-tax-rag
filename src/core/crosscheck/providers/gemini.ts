import type { CrosscheckInput, ProviderOutput } from "../types";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// Gemini REST (no SDK needed):
// POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=...
export async function callGemini(input: CrosscheckInput): Promise<ProviderOutput> {
  const t0 = Date.now();
  const apiKey = requireEnv("GEMINI_API_KEY");
  const model = process.env.GEMINI_MODEL || "gemini-1.5-pro";

  const prompt = [
    "You are a senior international tax advisor.",
    "Answer with: (1) direct answer, (2) assumptions, (3) risks, (4) needed facts, (5) authorities if known.",
    "",
    input.jurisdiction ? `Jurisdiction focus: ${input.jurisdiction}` : "",
    input.constraints ? `Constraints: ${input.constraints}` : "",
    input.facts ? `Facts:\n${input.facts}` : "",
    `Question:\n${input.question}`
  ].filter(Boolean).join("\n\n");

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: Math.min(Math.max(input.maxTokens ?? 900, 200), 2000)
        }
      })
    });

    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        provider: "gemini",
        model,
        status: "error",
        ms: Date.now() - t0,
        error: `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 800)}`
      };
    }

    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((p: any) => p?.text)
        .filter(Boolean)
        .join("\n") ?? "";

    return {
      provider: "gemini",
      model,
      status: "ok",
      ms: Date.now() - t0,
      text,
      usage: data?.usageMetadata
    };
  } catch (e: any) {
    return {
      provider: "gemini",
      model,
      status: "error",
      ms: Date.now() - t0,
      error: e?.message || String(e)
    };
  }
}

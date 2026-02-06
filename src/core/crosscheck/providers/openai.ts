import OpenAI from "openai";
import type { CrosscheckInput, ProviderOutput } from "../types";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function callOpenAI(input: CrosscheckInput): Promise<ProviderOutput> {
  const t0 = Date.now();
  const apiKey = requireEnv("OPENAI_API_KEY");
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const client = new OpenAI({ apiKey });

  const sys = [
    "You are a senior international tax advisor.",
    "Answer the user's question with: (1) direct answer, (2) key assumptions, (3) risks, (4) needed facts, (5) cited authorities if you know them.",
    "If you are not sure, say so and ask for missing facts.",
    "Keep it concise but professional."
  ].join("\n");

  const user = [
    input.jurisdiction ? `Jurisdiction focus: ${input.jurisdiction}` : "",
    input.constraints ? `Constraints: ${input.constraints}` : "",
    input.facts ? `Facts:\n${input.facts}` : "",
    `Question:\n${input.question}`
  ].filter(Boolean).join("\n\n");

  try {
    const resp = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user }
      ],
      temperature: 0.2,
      max_tokens: Math.min(Math.max(input.maxTokens ?? 900, 200), 2000)
    });

    const text = resp.choices?.[0]?.message?.content ?? "";
    return {
      provider: "openai",
      model,
      status: "ok",
      ms: Date.now() - t0,
      text,
      usage: resp.usage
    };
  } catch (e: any) {
    return {
      provider: "openai",
      model,
      status: "error",
      ms: Date.now() - t0,
      error: e?.message || String(e)
    };
  }
}

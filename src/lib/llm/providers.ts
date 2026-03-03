import { callOpenAICompatible, ChatMsg } from "./openaiCompatible";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export type ProviderId = "openai" | "perplexity" | "xai";

export async function runProvider(provider: ProviderId, messages: ChatMsg[]) {
  if (provider === "openai") {
    return callOpenAICompatible({
      baseURL: "https://api.openai.com/v1",
      apiKey: mustEnv("OPENAI_API_KEY"),
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages,
    });
  }

  if (provider === "perplexity") {
    return callOpenAICompatible({
      baseURL: process.env.PERPLEXITY_BASE_URL ?? "https://api.perplexity.ai",
      apiKey: mustEnv("PERPLEXITY_API_KEY"),
      model: process.env.PERPLEXITY_MODEL ?? "sonar-pro",
      messages,
    });
  }

  // xAI / Grok
  return callOpenAICompatible({
    baseURL: process.env.XAI_BASE_URL ?? "https://api.x.ai",
    apiKey: mustEnv("XAI_API_KEY"),
    model: process.env.XAI_MODEL ?? "grok-2-latest",
    messages,
  });
}
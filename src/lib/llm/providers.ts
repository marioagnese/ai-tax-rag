import { GoogleGenAI } from "@google/genai";
import { callOpenAICompatible, ChatMsg } from "./openaiCompatible";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export type ProviderId = "openai" | "perplexity" | "xai" | "gemini";

function flattenMessages(messages: ChatMsg[]) {
  return messages
    .map((m) => `${m.role.toUpperCase()}:\n${m.content}`)
    .join("\n\n");
}

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

  if (provider === "xai") {
    return callOpenAICompatible({
      baseURL: process.env.XAI_BASE_URL ?? "https://api.x.ai",
      apiKey: mustEnv("XAI_API_KEY"),
      model: process.env.XAI_MODEL ?? "grok-2-latest",
      messages,
    });
  }

  if (provider === "gemini") {
    const enabled = (process.env.GEMINI_ENABLED ?? "false").toLowerCase() === "true";
    if (!enabled) {
      throw new Error("Gemini provider is disabled.");
    }

    const ai = new GoogleGenAI({
      apiKey: mustEnv("GEMINI_API_KEY"),
    });

    const model = process.env.GEMINI_MODEL ?? "gemini-2.5-pro";

    const prompt = flattenMessages(messages);

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
    });

    return {
      text: response.text ?? "",
    };
  }

  throw new Error(`Unsupported provider: ${provider satisfies never}`);
}
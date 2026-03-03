import OpenAI from "openai";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export async function callOpenAICompatible(args: {
  baseURL: string;
  apiKey: string;
  model: string;
  messages: ChatMsg[];
  temperature?: number;
}) {
  const client = new OpenAI({
    apiKey: args.apiKey,
    baseURL: args.baseURL,
  });

  const resp = await client.chat.completions.create({
    model: args.model,
    messages: args.messages,
    temperature: args.temperature ?? 0.2,
  });

  return (resp.choices?.[0]?.message?.content ?? "").trim();
}
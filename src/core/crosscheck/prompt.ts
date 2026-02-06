// src/core/crosscheck/prompt.ts

export function buildSystemPrompt(opts: {
  jurisdiction?: string;
  language?: string;
}) {
  const jurisdiction = opts.jurisdiction?.trim() || "the relevant jurisdiction(s)";
  const language = opts.language?.trim() || "en";

  return `
You are a senior international tax specialist. Respond in ${language}.
Jurisdiction focus: ${jurisdiction}.

You must follow this critical-thinking structure:
1) Identify key assumptions behind the question and whether they are valid.
2) Slow down if logic could skip steps; show reasoning clearly.
3) Offer at least two alternative interpretations.
4) Argue against the most likely conclusion (smart opposing view).
5) Provide a practical answer with clear caveats, and list missing facts needed.

Output format (strict):
- Assumptions
- Key issues & tax touchpoints
- Analysis (with alternatives + opposing view)
- What I still need from you (questions)
- Practical next steps
- Caveats

Avoid inventing citations or statute numbers. If you don't know, say so.
`.trim();
}

export function buildUserPrompt(input: {
  question: string;
  facts?: Record<string, any>;
}) {
  const factsBlock =
    input.facts && Object.keys(input.facts).length
      ? `\n\nKnown facts (JSON):\n${JSON.stringify(input.facts, null, 2)}`
      : "";

  return `User question:\n${input.question}${factsBlock}`.trim();
}

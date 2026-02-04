import * as cheerio from "cheerio";

/**
 * Convert Planalto HTML into a paragraph-preserving plain text.
 * (Keeps line breaks so we can split by "Art." reliably.)
 */
export function planaltoHtmlToText(html: string): string {
  const $ = cheerio.load(html);

  // remove obvious noise
  $("script, style, noscript").remove();

  // Planalto pages usually have the law text inside main body; keep it simple:
  // gather paragraphs, list items, headings in order.
  const parts: string[] = [];

  // Prefer content-ish containers if present (but safe if not)
  const root =
    $("#conteudo").length ? $("#conteudo") :
    $("#content").length ? $("#content") :
    $("body");

  root.find("h1,h2,h3,h4,p,li,div").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text) return;

    // Avoid repeating huge nav/footer blocks (basic heuristic)
    if (text.length < 3) return;

    parts.push(text);
  });

  // Normalize to newline-delimited
  const out = parts.join("\n");
  return normalizeWhitespace(out);
}

export function normalizeWhitespace(s: string): string {
  return s
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Split CTN text into article-sized units.
 * We match lines like:
 *  - "Art. 3º ..."
 *  - "Art. 150. ..."
 */
export function splitBrazilArticles(plainText: string): Array<{
  article: string;
  section: string;
  text: string;
}> {
  const txt = normalizeWhitespace(plainText);

  // Ensure "Art." starts at line boundaries when possible
  const prepped = txt.replace(/(\s)(Art\.\s*\d+)/g, "\n$2");

  const re = /^Art\.\s*(\d+)(?:º|°)?\.?/gim;

  const matches: Array<{ idx: number; article: string }> = [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(prepped))) {
    matches.push({ idx: m.index, article: m[1] });
  }

  // If we can't find any articles, return the whole thing as one chunk
  if (matches.length === 0) {
    return [{
      article: "unknown",
      section: "CTN",
      text: prepped,
    }];
  }

  const chunks: Array<{ article: string; section: string; text: string }> = [];

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].idx;
    const end = i + 1 < matches.length ? matches[i + 1].idx : prepped.length;

    const block = prepped.slice(start, end).trim();
    const artNum = matches[i].article;

    // Keep a compact label users will see in citations
    const section = `Art. ${artNum}`;

    // Avoid tiny blocks (bad splits) — merge if needed
    if (block.length < 40) continue;

    chunks.push({
      article: artNum,
      section,
      text: block,
    });
  }

  return chunks.length ? chunks : [{
    article: "unknown",
    section: "CTN",
    text: prepped,
  }];
}

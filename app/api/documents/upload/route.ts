import { NextResponse } from "next/server";
import mammoth from "mammoth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

function normalizeWhitespace(text: string) {
  return text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function truncateText(text: string, maxChars = 20000) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n\n[Truncated for upload size limits]";
}

async function extractTxt(buffer: Buffer) {
  return normalizeWhitespace(buffer.toString("utf-8"));
}

async function extractDocx(buffer: Buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return normalizeWhitespace(result.value || "");
}

function buildSummary(text: string, filename: string) {
  const firstLines = text
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");

  if (!firstLines) return `Document uploaded: ${filename}`;

  const short = firstLines.slice(0, 240);
  return short.length < firstLines.length ? `${short}…` : short;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing file." }, { status: 400 });
    }

    if (file.type === "application/pdf") {
      return NextResponse.json(
        {
          ok: false,
          error: "PDF support is temporarily disabled while the parser is being stabilized. Please use DOCX or TXT for now."
        },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { ok: false, error: "Unsupported file type. Use DOCX or TXT." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { ok: false, error: "File too large. Maximum size is 10 MB." },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let text = "";

    if (file.type === "text/plain") {
      text = await extractTxt(buffer);
    } else if (
      file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      text = await extractDocx(buffer);
    }

    text = truncateText(text);

    if (!text.trim()) {
      return NextResponse.json(
        { ok: false, error: "Could not extract usable text from this document." },
        { status: 400 }
      );
    }

    const summary = buildSummary(text, file.name);

    return NextResponse.json({
      ok: true,
      document: {
        id: crypto.randomUUID(),
        name: file.name,
        mimeType: file.type,
        size: file.size,
        text,
        summary,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Document upload failed." },
      { status: 500 }
    );
  }
}

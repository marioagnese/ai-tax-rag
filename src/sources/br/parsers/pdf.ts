// src/sources/br/parsers/pdf.ts
// STUB (build-stable): PDF parsing temporarily disabled.
// We keep this module so imports compile.
// Later, we can replace with a robust PDF implementation.

export async function pdfToText(_buf: Buffer): Promise<string> {
  throw new Error(
    "PDF parsing is temporarily disabled to stabilize builds. Use HTML sources or re-enable PDF parser."
  );
}

// default export for compatibility with older callers
export default pdfToText;

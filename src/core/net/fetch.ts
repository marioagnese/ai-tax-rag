import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type FetchWithRetryOptions = RequestInit & {
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  curlFallback?: boolean;

  /**
   * Optional list of alternate URLs (official mirrors) to try if primary fails.
   */
  altUrls?: string[];
};

const DEFAULT_UA = "ai-tax-rag/1.0 (+https://example.local)";
const DEFAULT_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const DEFAULT_ACCEPT_LANG = "pt-BR,pt;q=0.9,en;q=0.8";

export async function fetchWithRetry(
  url: string,
  opts: FetchWithRetryOptions = {}
): Promise<Response> {
  const {
    retries = 6,
    retryDelayMs = 800,
    timeoutMs = 20000,
    curlFallback = true,
    altUrls = [],
    ...init
  } = opts;

  const candidates = [url, ...altUrls].filter(Boolean);
  let lastErr: any = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    for (const candidateUrl of candidates) {
      try {
        const res = await fetchAttempt(candidateUrl, init, timeoutMs);

        // Retry on 5xx
        if (res.status >= 500 && res.status <= 599) {
          lastErr = new Error(`HTTP ${res.status} from ${candidateUrl}`);
          await sleep(backoff(retryDelayMs, attempt));
          continue;
        }

        return res;
      } catch (e: any) {
        lastErr = e;

        const msg = String(e?.message || "");
        const causeCode = e?.cause?.code;

        const isConnReset =
          causeCode === "ECONNRESET" ||
          msg.includes("ECONNRESET") ||
          msg.includes("fetch failed") ||
          msg.includes("UND_ERR_SOCKET") ||
          msg.toLowerCase().includes("socket") ||
          msg.toLowerCase().includes("tls");

        if (curlFallback && isConnReset) {
          try {
            return await fetchViaCurl(candidateUrl, init);
          } catch (curlErr: any) {
            lastErr = curlErr;
          }
        }

        await sleep(backoff(retryDelayMs, attempt));
      }
    }
  }

  throw lastErr || new Error("fetchWithRetry failed");
}

async function fetchAttempt(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers = buildHeaders(init.headers);

  try {
    return await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function buildHeaders(initHeaders: HeadersInit | undefined) {
  const headers = new Headers(initHeaders || {});
  if (!headers.get("user-agent")) headers.set("user-agent", DEFAULT_UA);
  if (!headers.get("accept")) headers.set("accept", DEFAULT_ACCEPT);
  if (!headers.get("accept-language")) headers.set("accept-language", DEFAULT_ACCEPT_LANG);
  return headers;
}

function backoff(baseMs: number, attempt: number) {
  const jitter = Math.floor(Math.random() * 200);
  return Math.min(20000, baseMs * Math.pow(2, attempt - 1) + jitter);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Curl fallback: returns a real Response object (status 200..599 only).
 * If curl returns 000 (no HTTP response), we THROW so retry loop continues.
 */
async function fetchViaCurl(url: string, init: RequestInit): Promise<Response> {
  const method = (init.method || "GET").toUpperCase();

  const args: string[] = [
    "-sS",
    "-L",
    "--compressed",
    "--http1.1",
    "--tlsv1.2",
    "--retry",
    "6",
    "--retry-all-errors",
    "--retry-delay",
    "1",
    "--connect-timeout",
    "15",
    "--max-time",
    "60",
    "-X",
    method,
  ];

  const headers = buildHeaders(init.headers);
  headers.forEach((v, k) => args.push("-H", `${k}: ${v}`));

  if (init.body && typeof init.body === "string") {
    args.push("--data-raw", init.body);
  }

  // Print status code on last line
  args.push("-w", "\n%{http_code}", url);

  let stdout = "";
  let stderr = "";

  try {
    const r = await execFileAsync("curl", args, { maxBuffer: 20 * 1024 * 1024 });
    stdout = String(r.stdout || "");
    stderr = String(r.stderr || "");
  } catch (e: any) {
    stdout = String(e?.stdout || "");
    stderr = String(e?.stderr || "");
    // If curl exited and provided no parsable output, throw
    if (!stdout) throw e;
  }

  const out = String(stdout || "");
  const lastNewline = out.lastIndexOf("\n");
  if (lastNewline < 0) {
    throw new Error(`curl fallback failed: no status line. stderr=${stderr || ""}`);
  }

  const bodyText = out.slice(0, lastNewline);
  const statusStr = out.slice(lastNewline + 1).trim();
  const status = parseInt(statusStr, 10);

  // curl "000" => no HTTP response
  if (!Number.isFinite(status) || status < 200 || status > 599) {
    throw new Error(
      `curl fallback failed: status=${statusStr} url=${url} stderr=${stderr || ""}`
    );
  }

  return new Response(bodyText, { status });
}

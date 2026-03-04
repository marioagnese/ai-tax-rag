"use client";

import { useMemo, useState } from "react";

type Citation = {
  cite: string;
  id: string;
  score: number;
  country: string | null;
  law_code: string | null;
  article: string | null;
  section: string | null;
  source_type: string | null;
  citation_label: string | null;
  source_url: string | null;
  chunk_id: string | null;
  page_start: number | null;
  page_end: number | null;
  snippet: string;
};

export default function ChatPage() {
  const [country, setCountry] = useState("Brazil");
  const [q, setQ] = useState("Qual é a definição de tributo no CTN?");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string>("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [error, setError] = useState<string>("");

  const exampleQuestions = useMemo(() => {
    return {
      Brazil: "Qual é a definição de tributo no CTN?",
      Mexico: "¿Quién está obligado al pago del ISR según la LISR?",
      Colombia: "¿Cuál es el origen de la obligación tributaria sustancial según el Estatuto Tributario?"
    } as Record<string, string>;
  }, []);

  async function ask() {
    setLoading(true);
    setError("");
    setAnswer("");
    setCitations([]);
    try {
      const url = `/api/ask?q=${encodeURIComponent(q)}&country=${encodeURIComponent(country)}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || "Request failed");
        return;
      }
      setAnswer(json.answer || "");
      setCitations(json.citations || []);
    } catch (e: any) {
      setError(e?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>AI Tax RAG — MVP Chat</h1>
      <p style={{ marginTop: 0, color: "#666" }}>Ask a question, filter by country, and verify citations.</p>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <label style={{ fontWeight: 600 }}>Country</label>
        <select
          value={country}
          onChange={(e) => {
            const c = e.target.value;
            setCountry(c);
            setQ(exampleQuestions[c] || "");
          }}
          style={{ padding: 8, borderRadius: 8, border: "1px solid #ccc" }}
        >
          <option value="Brazil">Brazil</option>
          <option value="Mexico">Mexico</option>
          <option value="Colombia">Colombia</option>
        </select>

        <button
          onClick={() => setQ(exampleQuestions[country] || "")}
          style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ccc", background: "white", cursor: "pointer" }}
        >
          Load example
        </button>
      </div>

      <textarea
        value={q}
        onChange={(e) => setQ(e.target.value)}
        rows={4}
        placeholder="Type your tax question..."
        style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid #ccc", marginBottom: 12 }}
      />

      <button
        onClick={ask}
        disabled={loading || !q.trim()}
        style={{
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid #111",
          background: loading ? "#ddd" : "#111",
          color: loading ? "#222" : "white",
          cursor: loading ? "not-allowed" : "pointer",
          fontWeight: 700
        }}
      >
        {loading ? "Asking..." : "Ask"}
      </button>

      {error && (
        <div style={{ marginTop: 16, padding: 12, borderRadius: 10, border: "1px solid #f2c0c0", background: "#fff3f3", color: "#8a1f1f" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {answer && (
        <div style={{ marginTop: 18, padding: 14, borderRadius: 12, border: "1px solid #ddd", background: "#fafafa" }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>Answer</h2>
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{answer}</div>
        </div>
      )}

      {citations.length > 0 && (
        <div style={{ marginTop: 18, padding: 14, borderRadius: 12, border: "1px solid #ddd" }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>Citations</h2>
          <div style={{ display: "grid", gap: 10 }}>
            {citations.map((c) => (
              <div key={c.cite} style={{ padding: 12, borderRadius: 10, border: "1px solid #eee", background: "white" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 800 }}>{c.cite} — {c.citation_label} {c.article ? `Art. ${c.article}` : ""}</div>
                  <div style={{ color: "#666" }}>score: {Number(c.score).toFixed(3)}</div>
                </div>
                {c.source_url && (
                  <div style={{ marginTop: 6 }}>
                    <a href={c.source_url} target="_blank" rel="noreferrer" style={{ color: "#0b57d0" }}>
                      Open source
                    </a>
                  </div>
                )}
                <div style={{ marginTop: 8, color: "#444" }}>{c.snippet}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 24, color: "#777", fontSize: 13 }}>
        Tip: open <code>/chat</code> on your deployed Vercel app.
      </div>
    </div>
  );
}

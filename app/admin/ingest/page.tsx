"use client";

import { useMemo, useState } from "react";

type Result =
  | { ok: true; index: string; namespace: string; embed_model: string; upserted: number }
  | { ok: false; error: string };

export default function AdminIngestPage() {
  const [ingestKey, setIngestKey] = useState("");
  const [payload, setPayload] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const examples = useMemo(() => {
    return {
      Brazil: {
        defaults: {
          country: "Brazil",
          source_type: "Statute",
          law_code: "CTN",
          source_url: "https://www.planalto.gov.br/ccivil_03/leis/l5172compilado.htm",
          citation_label: "CTN"
        },
        docs: [
          {
            id: "br_ctn_art_3_v1_chunk1",
            text: "CTN Art. 3º: Tributo é toda prestação pecuniária compulsória...",
            metadata: { article: "3", section: "Art. 3º" }
          }
        ]
      },
      Mexico: {
        defaults: {
          country: "Mexico",
          source_type: "Statute",
          law_code: "LISR",
          source_url: "https://portalhcd.diputados.gob.mx/LeyesBiblio/PortalWeb/Leyes/Vigentes/PDF/LISR_230421.pdf",
          citation_label: "LISR"
        },
        docs: [
          {
            id: "mx_lisr_art_1_v1_chunk1",
            text:
              "Artículo 1. Las personas físicas y las morales están obligadas al pago del impuesto sobre la renta en los siguientes casos:\n" +
              "I. Las residentes en México, respecto de todos sus ingresos...\n" +
              "II. Los residentes en el extranjero que tengan un establecimiento permanente...",
            metadata: { article: "1", section: "Art. 1", page_start: 1, page_end: 1 }
          }
        ]
      },
      Colombia: {
        defaults: {
          country: "Colombia",
          source_type: "Statute",
          law_code: "ET",
          source_url: "https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=6533",
          citation_label: "Estatuto Tributario"
        },
        docs: [
          {
            id: "co_et_art_1_v1_chunk1",
            text:
              "ARTÍCULO 1° ORIGEN DE LA OBLIGACIÓN SUSTANCIAL. " +
              "La obligación tributaria sustancial se origina al realizarse el presupuesto o los presupuestos previstos en la ley " +
              "como generadores del impuesto y ella tiene por objeto el pago del tributo.",
            metadata: { article: "1", section: "Art. 1" }
          }
        ]
      }
    } as Record<string, any>;
  }, []);

  function loadExample(key: "Brazil" | "Mexico" | "Colombia") {
    setResult(null);
    setPayload(JSON.stringify(examples[key], null, 2));
  }

  async function ingest() {
    setResult(null);

    let parsed: any;
    try {
      parsed = JSON.parse(payload);
    } catch {
      setResult({ ok: false, error: "Invalid JSON payload. Fix the JSON and try again." });
      return;
    }

    if (!ingestKey.trim()) {
      setResult({ ok: false, error: "Missing Ingest Key. Paste it in the field above." });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-ingest-key": ingestKey.trim()
        },
        body: JSON.stringify(parsed)
      });

      const json = await res.json();
      setResult(json);
    } catch (e: any) {
      setResult({ ok: false, error: e?.message || "Unknown error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Admin — Ingest</h1>
      <p style={{ color: "#666", marginTop: 0 }}>
        Paste an ingestion payload (JSON) and send it to <code>/api/ingest</code>.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={() => loadExample("Brazil")} style={btn}>Load BR example</button>
        <button onClick={() => loadExample("Mexico")} style={btn}>Load MX example</button>
        <button onClick={() => loadExample("Colombia")} style={btn}>Load CO example</button>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        <div>
          <label style={{ fontWeight: 700, display: "block", marginBottom: 6 }}>Ingest Key</label>
          <input
            value={ingestKey}
            onChange={(e) => setIngestKey(e.target.value)}
            placeholder="Paste INGEST_KEY here (same as x-ingest-key)"
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
          />
          <div style={{ marginTop: 6, fontSize: 13, color: "#777" }}>
            This key is not saved; it’s only used for this request.
          </div>
        </div>

        <div>
          <label style={{ fontWeight: 700, display: "block", marginBottom: 6 }}>Payload JSON</label>
          <textarea
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            rows={18}
            placeholder='{"defaults": {...}, "docs": [...]}'
            style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #ccc", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
          />
        </div>

        <button onClick={ingest} disabled={loading} style={{ ...btnPrimary, opacity: loading ? 0.6 : 1 }}>
          {loading ? "Ingesting..." : "Ingest to Pinecone"}
        </button>

        {result && (
          <div style={{ padding: 14, borderRadius: 12, border: "1px solid #ddd", background: "#fafafa" }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>
              Result: {result.ok ? "✅ OK" : "❌ Error"}
            </div>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(result, null, 2)}</pre>
          </div>
        )}
      </div>

      <div style={{ marginTop: 18, color: "#777", fontSize: 13 }}>
        Tip: Open <code>/admin/ingest</code> on your Vercel app.
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #ccc",
  background: "white",
  cursor: "pointer",
  fontWeight: 700
};

const btnPrimary: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid #111",
  background: "#111",
  color: "white",
  cursor: "pointer",
  fontWeight: 800
};

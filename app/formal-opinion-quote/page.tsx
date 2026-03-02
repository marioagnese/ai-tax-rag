import QuoteForm from "./quote-form";

export const metadata = {
  title: "Formal Opinion Quote — TaxAiPro",
};

export default function FormalOpinionQuotePage() {
  return (
    <div className="min-h-screen bg-[#070A12] text-white">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6">
          <a
            href="/crosscheck"
            className="inline-flex items-center rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/85 hover:bg-white/10"
          >
            ← Return to Crosscheck
          </a>

          <h1 className="mt-4 text-2xl font-semibold text-white/95">Formal opinion quote</h1>
          <p className="mt-2 text-sm text-white/60">
            Submit your facts for a scoped quote. This is not legal advice — it’s a pricing + timeline estimate.
          </p>
        </div>

        <QuoteForm />
      </div>
    </div>
  );
}
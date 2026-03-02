import QuoteForm from "./quote-form";

export const metadata = {
  title: "Formal Opinion Quote — TaxAiPro",
};

export default function FormalOpinionQuotePage() {
  return (
    <div className="min-h-screen bg-[#070A12] text-white">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-white/95">Formal opinion quote</h1>
          <p className="mt-2 text-sm text-white/60">
            Submit your facts for a scoped quote. This is not legal advice — it’s a pricing + timeline estimate.
          </p>
        </div>
        <QuoteForm />
      </div>
    </div>
  );
}

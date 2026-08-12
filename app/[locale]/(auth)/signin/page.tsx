"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

type Locale = "en" | "es" | "pt";

export default function SigninPage() {
  const router = useRouter();
  const params = useParams<{ locale?: string }>();

  const locale =
    typeof params?.locale === "string" &&
    ["en", "es", "pt"].includes(params.locale)
      ? (params.locale as Locale)
      : "en";

  useEffect(() => {
    router.replace(`/${locale}/signup?mode=login#login`);
  }, [locale, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#07101d] text-sm text-white/60">
      Opening TaxAiPro login...
    </div>
  );
}

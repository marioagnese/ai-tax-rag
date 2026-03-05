import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";

const DEFAULT_LOCALE = "en";

const intlMiddleware = createMiddleware({
  locales: ["en", "es", "pt"],
  defaultLocale: DEFAULT_LOCALE,
  // Use "always" to avoid /en <-> / redirect ping-pong while you stabilize
  localePrefix: "always",
});

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ✅ If someone hits the old non-localized auth routes, redirect ONCE to the real ones
  if (pathname === "/signin") {
    return NextResponse.redirect(new URL(`/${DEFAULT_LOCALE}/signin`, req.url));
  }
  if (pathname === "/signup") {
    return NextResponse.redirect(new URL(`/${DEFAULT_LOCALE}/signup`, req.url));
  }

  // Everything else uses next-intl routing
  return intlMiddleware(req);
}

export const config = {
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
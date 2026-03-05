import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";

const intlMiddleware = createMiddleware({
  locales: ["en", "es", "pt"],
  defaultLocale: "en",
  localePrefix: "as-needed"
});

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 🚫 Never localize auth pages
  if (
    pathname === "/signin" ||
    pathname === "/signup" ||
    pathname.startsWith("/en/signin") ||
    pathname.startsWith("/es/signin") ||
    pathname.startsWith("/pt/signin") ||
    pathname.startsWith("/en/signup") ||
    pathname.startsWith("/es/signup") ||
    pathname.startsWith("/pt/signup")
  ) {
    return NextResponse.next();
  }

  return intlMiddleware(req);
}

export const config = {
  matcher: ["/((?!api|_next|.*\\..*).*)"]
};
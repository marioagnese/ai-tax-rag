import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// IMPORTANT: never proxy/rewrite Next.js API routes.
// This prevents /api/* (including /api/crosscheck) from being rewritten to /404 in production.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // If you had prior proxy/rewrite logic, keep it below.
  // For now, default to pass-through to avoid breaking routes.
  return NextResponse.next();
}

// Run middleware only for non-API paths.
export const config = {
  matcher: ["/((?!api/).*)"],
};

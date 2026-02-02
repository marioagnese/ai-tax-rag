import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Protect admin UI routes
  if (pathname.startsWith("/admin")) {
    const key =
      req.headers.get("x-ingest-key") ||
      req.headers.get("x-admin-key") ||
      req.nextUrl.searchParams.get("key") ||
      "";

    // IMPORTANT: allow fallback to ADMIN_SECRET for Vercel
    const expected =
      process.env.INGEST_KEY ||
      process.env.ADMIN_SECRET ||
      "";

    if (!expected || key !== expected) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};

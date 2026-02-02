import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  // Protect anything under /admin
  if (req.nextUrl.pathname.startsWith("/admin")) {
    const secret = process.env.ADMIN_SECRET || "";
    const provided = req.headers.get("x-admin-secret") || "";

    // If you haven't set ADMIN_SECRET yet, block by default
    if (!secret || provided !== secret) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};

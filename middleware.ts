import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

// Narrow, explicit matcher — only the NEW Admin Control backoffice routes.
// Deliberately does NOT cover /dashboard/admin/demo or the existing
// /api/admin/diagnostics|demo-gestoria|delivery-notes routes: those keep
// being gated exactly as before by ADMIN_EMAILS inside each route/page
// (see lib/admin/auth.ts). This middleware only adds a real HTTP 403 for
// direct navigation to the new platform_admin-only pages/APIs.
export const config = {
  matcher: [
    "/dashboard/admin",
    "/dashboard/admin/companies/:path*",
    "/dashboard/admin/reports",
    "/api/admin/overview",
    "/api/admin/companies/:path*",
    "/api/admin/reports/:path*",
  ],
};

export async function middleware(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token?.isPlatformAdmin) {
    const isApi = req.nextUrl.pathname.startsWith("/api/");
    if (isApi) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return new NextResponse("403 Forbidden", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return NextResponse.next();
}

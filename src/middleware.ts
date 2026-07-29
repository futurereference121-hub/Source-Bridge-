import { type NextRequest, NextResponse } from "next/server";

/**
 * Edge middleware — runs before every matched request.
 *
 * Responsibility: route ADMIN users away from ordinary member pages and
 * redirect normal users away from admin-only pages.
 *
 * Authorization (proving who the user really is) happens server-side via
 * the httpOnly session cookie + DB lookup. This middleware uses only the
 * non-sensitive `sb_role` hint cookie for lightweight routing — it never
 * grants access based on that cookie alone.
 */

// Paths that are only for ordinary (non-admin) users.
const USER_ONLY_PATHS = [
  "/explore",
  "/profile",
  "/inbox",
  "/messages",
  "/requests",
  "/sourcing",
  "/activity",
  "/onboarding",
  "/members",
  "/marketplace",
  "/checkout",
  "/check-email",
];

// Paths that are only for admins.
const ADMIN_ONLY_PATHS = ["/admin"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const role = request.cookies.get("sb_role")?.value ?? "";
  const isAdmin = role === "ADMIN";

  // Admin visiting a user-only route → send to verification queue.
  if (isAdmin) {
    const blocked = USER_ONLY_PATHS.some(
      (p) => pathname === p || pathname.startsWith(p + "/"),
    );
    if (blocked) {
      return NextResponse.redirect(new URL("/admin/verifications", request.url));
    }
  }

  // Non-admin (or unauthenticated) visiting admin-only routes.
  // The server components themselves also verify role via DB — this is an
  // extra layer to avoid flashing admin UI before the server check runs.
  if (!isAdmin) {
    const isAdminPath = ADMIN_ONLY_PATHS.some(
      (p) => pathname === p || pathname.startsWith(p + "/"),
    );
    // Allow sign-in and create-password which are the entry points.
    const isPublicAdminEntry =
      pathname === "/admin/sign-in" ||
      pathname === "/admin/create-password" ||
      pathname.startsWith("/api/auth/admin");
    if (isAdminPath && !isPublicAdminEntry) {
      return NextResponse.redirect(new URL("/admin/sign-in", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static, _next/image (Next.js assets)
     * - favicon.ico, public files
     * - API routes (auth is handled server-side there)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|uploads/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
  ],
};

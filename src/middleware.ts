import { type NextRequest, NextResponse } from "next/server";

/**
 * Edge middleware — runs before every matched request.
 *
 * Uses the non-sensitive `sb_role` hint cookie (set by createSession, cleared
 * by destroySession) to route requests before the server components run.
 * Real authorization is always enforced server-side via the httpOnly session
 * cookie + DB lookup — this middleware only handles routing, never access grants.
 */

// Paths only accessible to ordinary (non-admin) signed-in users.
const USER_ONLY_PREFIXES = [
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

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const role = request.cookies.get("sb_role")?.value ?? "";
  const isAdmin = role === "ADMIN";

  // ── Admin routing ────────────────────────────────────────────────────────
  if (isAdmin) {
    // Admin visiting a user-only route → verification queue.
    const blockedForAdmin = USER_ONLY_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(p + "/"),
    );
    if (blockedForAdmin) {
      return NextResponse.redirect(new URL("/admin/verifications", request.url));
    }

    // Admin visiting /admin/sign-in while already authenticated → queue.
    // (The client also handles this, but the middleware catches hard navigations.)
    if (pathname === "/admin/sign-in") {
      return NextResponse.redirect(new URL("/admin/verifications", request.url));
    }

    // Everything else under /admin is fine for an admin.
    return NextResponse.next();
  }

  // ── Non-admin routing ────────────────────────────────────────────────────
  const isAdminPath =
    pathname === "/admin" || pathname.startsWith("/admin/");
  const isPublicAdminEntry =
    pathname === "/admin/sign-in" ||
    pathname === "/admin/create-password";

  // Ordinary signed-in users must never see admin UI (including admin sign-in).
  // Role comes from the non-sensitive sb_role hint; real auth is still server-side.
  if (isAdminPath && role === "USER") {
    return NextResponse.redirect(new URL("/explore", request.url));
  }

  // Unauthenticated visitors hitting protected admin pages go to admin sign-in.
  // Authenticated normal users are handled above; admins handled earlier.
  if (isAdminPath && !isPublicAdminEntry) {
    return NextResponse.redirect(new URL("/admin/sign-in", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except Next.js internals and static assets.
     * API routes are excluded — auth is enforced server-side there.
     */
    "/((?!_next/static|_next/image|favicon\\.ico|api/|uploads/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
  ],
};

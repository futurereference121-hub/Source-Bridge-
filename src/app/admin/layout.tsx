import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, isAdminUser } from "@/lib/auth";
import AdminSignOutButton from "./_components/AdminSignOutButton";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  const isAdmin = Boolean(user && isAdminUser(user));

  // Non-admin or unauthenticated users on any /admin/* page (except sign-in /
  // create-password which the middleware already guards) should not reach here.
  // Middleware handles the redirect for most cases; this is a belt-and-suspenders
  // check for the server component render path.
  if (!isAdmin && user) {
    // Authenticated as a normal user — send them away.
    redirect("/explore");
  }

  return (
    <div className="min-h-screen bg-app-navy px-6 py-10 text-white">
      {isAdmin ? (
        <nav className="mx-auto mb-10 flex max-w-6xl flex-wrap items-center gap-6 text-sm text-white/70">
          <Link
            href="/admin/verifications"
            className="font-medium text-electric hover:text-electric-hover"
          >
            Verification Applicants
          </Link>
          <AdminSignOutButton />
        </nav>
      ) : (
        <nav className="mx-auto mb-10 flex max-w-6xl gap-5 text-sm text-white/70">
          <Link href="/admin/sign-in" className="hover:text-white">
            Admin sign in
          </Link>
        </nav>
      )}
      <main className="mx-auto max-w-6xl">{children}</main>
    </div>
  );
}

import Link from "next/link";
import { getSessionUser, isAdminUser } from "@/lib/auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  const admin = Boolean(user && isAdminUser(user));

  return (
    <div className="min-h-screen bg-app-navy px-6 py-10 text-white">
      {admin ? (
        <nav className="mx-auto mb-10 flex max-w-6xl flex-wrap gap-5 text-sm text-white/70">
          <Link href="/admin" className="hover:text-white">
            Dashboard
          </Link>
          <Link href="/admin/verifications" className="hover:text-white">
            Verifications
          </Link>
          <Link href="/explore" className="hover:text-white">
            Return to site
          </Link>
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

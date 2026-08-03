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

  // Authenticated ordinary users must never render admin chrome or forms.
  if (!isAdmin && user) {
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
          <Link
            href="/admin/payments"
            className="font-medium text-electric hover:text-electric-hover"
          >
            Protected Payments
          </Link>
          <AdminSignOutButton />
        </nav>
      ) : null}
      <main className="mx-auto max-w-6xl">{children}</main>
    </div>
  );
}

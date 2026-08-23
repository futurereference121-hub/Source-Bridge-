import { redirect } from "next/navigation";
import { getSessionUser, isAdminUser } from "@/lib/auth";
import AdminNav from "./_components/AdminNav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  const isAdmin = Boolean(user && isAdminUser(user));

  // Authenticated ordinary users must never render admin chrome or forms.
  // Keep this redirect out of soft-nav failure paths for true admins — only
  // bounce when we positively know the signed-in user is not an admin.
  if (user && !isAdmin) {
    redirect("/explore");
  }

  return (
    <div className="min-h-screen bg-app-navy px-6 py-10 text-white">
      {isAdmin ? <AdminNav /> : null}
      <main className="mx-auto max-w-6xl">{children}</main>
    </div>
  );
}

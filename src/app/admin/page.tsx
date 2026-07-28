import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, isAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function AdminDashboard() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/sign-in");
  if (!isAdminUser(user)) redirect("/explore");
  if (user.mustChangePassword) redirect("/admin/change-password");

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [pending, approvedToday, rejectedToday, totalVerifiedMembers] =
    await Promise.all([
      prisma.identityVerificationRequest.count({ where: { status: "PENDING" } }),
      prisma.identityVerificationRequest.count({
        where: { status: "VERIFIED", approvedAt: { gte: startOfDay } },
      }),
      prisma.identityVerificationRequest.count({
        where: { status: "REJECTED", rejectedAt: { gte: startOfDay } },
      }),
      prisma.user.count({
        where: { identityVerified: true, identityVerificationStatus: "VERIFIED" },
      }),
    ]);

  const cards = [
    ["Pending verifications", pending],
    ["Approved today", approvedToday],
    ["Rejected today", rejectedToday],
    ["Total verified members", totalVerifiedMembers],
  ] as const;

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-electric">
        Source Bridge administration
      </p>
      <h1 className="mt-2 font-display text-4xl">Verification dashboard</h1>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-white/10 bg-white/5 p-5"
          >
            <p className="text-sm text-white/60">{label}</p>
            <p className="mt-2 text-3xl font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <Link
        className="mt-8 inline-block rounded-lg bg-electric px-4 py-2 font-medium text-app-navy"
        href="/admin/verifications"
      >
        Review verification queue
      </Link>
    </>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, isAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type Search = Promise<{ status?: string }>;

export default async function VerificationQueue({
  searchParams,
}: {
  searchParams: Search;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/sign-in");
  if (!isAdminUser(user)) redirect("/explore");
  if (user.mustChangePassword) redirect("/admin/change-password");

  const params = await searchParams;
  const statusFilter = (params.status || "PENDING").toUpperCase();
  const allowed = ["PENDING", "VERIFIED", "REJECTED", "ALL"];
  const status = allowed.includes(statusFilter) ? statusFilter : "PENDING";

  const requests = await prisma.identityVerificationRequest.findMany({
    where: {
      ...(status === "ALL" ? { status: { in: ["PENDING", "VERIFIED", "REJECTED"] } } : { status }),
      NOT: { status: "DRAFT" },
    },
    orderBy:
      status === "PENDING"
        ? [{ submittedAt: "asc" }, { createdAt: "asc" }]
        : [{ reviewedAt: "desc" }, { createdAt: "desc" }],
    include: {
      user: {
        select: {
          name: true,
          username: true,
          photo: true,
          country: true,
          createdAt: true,
        },
      },
      documents: {
        where: { deletedAt: null },
        select: { id: true, kind: true },
      },
    },
  });

  function waitingLabel(submittedAt: Date | null, createdAt: Date) {
    const start = submittedAt || createdAt;
    const hours = Math.max(
      0,
      Math.floor((Date.now() - start.getTime()) / 3_600_000),
    );
    if (hours < 24) return `${hours}h waiting`;
    return `${Math.floor(hours / 24)}d waiting`;
  }

  return (
    <>
      <h1 className="font-display text-3xl">Verification queue</h1>
      <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.12em]">
        {(["PENDING", "VERIFIED", "REJECTED", "ALL"] as const).map((s) => (
          <Link
            key={s}
            href={`/admin/verifications?status=${s}`}
            className={`rounded-full border px-3 py-1 ${
              status === s
                ? "border-electric/50 bg-electric/15 text-electric"
                : "border-white/15 text-white/55 hover:text-white"
            }`}
          >
            {s === "VERIFIED" ? "Approved" : s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
          </Link>
        ))}
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-white/10">
        {requests.length === 0 ? (
          <p className="p-5 text-white/60">No requests in this filter.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 text-[11px] uppercase tracking-[0.12em] text-white/45">
              <tr>
                <th className="px-4 py-3 font-medium">Applicant</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Country</th>
                <th className="px-4 py-3 font-medium">Document</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Submitted</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr
                  key={request.id}
                  className="border-b border-white/10 last:border-0 hover:bg-white/5"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/verifications/${request.id}`}
                      className="flex items-center gap-3"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={request.user.photo || "/uploads/placeholders/avatar.svg"}
                        alt=""
                        className="h-9 w-9 rounded-full object-cover"
                      />
                      <span>
                        <span className="block font-medium text-white">
                          {request.user.username
                            ? `@${request.user.username}`
                            : request.user.name}
                        </span>
                        <span className="block text-xs text-white/45">
                          {request.user.name}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="hidden px-4 py-3 text-white/60 sm:table-cell">
                    {request.user.country || "—"}
                  </td>
                  <td className="px-4 py-3 text-white/70">
                    {request.documentType.replace(/_/g, " ")}
                  </td>
                  <td className="hidden px-4 py-3 text-white/55 md:table-cell">
                    {(request.submittedAt || request.createdAt).toLocaleString()}
                    {request.status === "PENDING" ? (
                      <span className="mt-1 block text-xs text-amber-200/80">
                        {waitingLabel(request.submittedAt, request.createdAt)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/verifications/${request.id}`}
                      className="text-electric hover:text-electric-hover"
                    >
                      {request.status}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

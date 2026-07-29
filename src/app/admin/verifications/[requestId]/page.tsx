import { notFound, redirect } from "next/navigation";
import { getSessionUser, isAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import ReviewActions from "./review-actions";
import DocFrame from "./doc-frame";

type Props = { params: Promise<{ requestId: string }> };

export default async function VerificationReviewPage({ params }: Props) {
  const session = await getSessionUser();
  if (!session) redirect("/admin/sign-in");
  if (!isAdminUser(session)) redirect("/explore");
  if (session.mustChangePassword) redirect("/admin/change-password");

  const { requestId } = await params;
  const request = await prisma.identityVerificationRequest.findUnique({
    where: { id: requestId },
    include: {
      user: {
        select: {
          name: true,
          username: true,
          email: true,
          country: true,
          city: true,
          photo: true,
          createdAt: true,
          identityVerified: true,
          identityVerificationStatus: true,
        },
      },
      documents: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, kind: true, mimeType: true, createdAt: true },
      },
      auditEvents: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, action: true, createdAt: true, actorUserId: true },
      },
    },
  });
  if (!request || request.status === "DRAFT") notFound();

  const front = request.documents.find((d) => d.kind === "front");
  const back = request.documents.find((d) => d.kind === "back");
  const selfie = request.documents.find((d) => d.kind === "selfie");

  return (
    <>
      <h1 className="font-display text-3xl">Review verification</h1>
      <p className="mt-2 text-white/60">
        {request.user.username ? `@${request.user.username}` : request.user.name}{" "}
        · {request.documentType.replace(/_/g, " ")} · {request.status}
      </p>

      <section className="mt-6 grid gap-4 rounded-xl border border-white/10 bg-white/5 p-5 sm:grid-cols-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-white/45">
            Applicant
          </p>
          <p className="mt-2 text-white">{request.user.name}</p>
          <p className="text-sm text-white/55">
            {request.user.username ? `@${request.user.username}` : "No username"}
          </p>
          <p className="mt-2 text-sm text-white/55">
            {[request.user.city, request.user.country].filter(Boolean).join(", ") ||
              "Location not set"}
          </p>
          <p className="mt-2 text-xs text-white/40">
            Account created {request.user.createdAt.toLocaleDateString()}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-white/45">
            Submission
          </p>
          <p className="mt-2 text-sm text-white/70">
            Submitted{" "}
            {(request.submittedAt || request.createdAt).toLocaleString()}
          </p>
          <p className="mt-1 text-sm text-white/55">
            Current badge state:{" "}
            {request.user.identityVerified ? "Verified" : "Not verified"}
          </p>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
          Documents (authorised temporary view)
        </h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            {front ? (
              <DocFrame
                label="Identity document (front)"
                src={`/api/verification/documents/${front.id}/file`}
              />
            ) : null}
            {back ? (
              <DocFrame
                label="Identity document (back)"
                src={`/api/verification/documents/${back.id}/file`}
              />
            ) : null}
            {!front && !back
              ? request.documents
                  .filter((d) => d.kind !== "selfie")
                  .map((d) => (
                    <DocFrame
                      key={d.id}
                      label={d.kind}
                      src={`/api/verification/documents/${d.id}/file`}
                    />
                  ))
              : null}
          </div>
          <div>
            {selfie ? (
              <DocFrame
                label="Selfie holding document"
                src={`/api/verification/documents/${selfie.id}/file`}
              />
            ) : (
              <p className="text-sm text-white/50">No selfie uploaded.</p>
            )}
          </div>
        </div>
      </section>

      {request.status === "PENDING" ? (
        <ReviewActions requestId={request.id} />
      ) : (
        <p className="mt-8 text-sm text-white/60">
          This request is {request.status}
          {request.rejectionReason
            ? ` — ${request.rejectionReason}`
            : ""}
          .
        </p>
      )}

      <section className="mt-10">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
          Audit history
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-white/55">
          {request.auditEvents.map((event) => (
            <li key={event.id}>
              {event.action} · {event.createdAt.toLocaleString()}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}


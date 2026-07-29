"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Container } from "@/components/ui/Container";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useAppUi } from "@/components/providers/AppProviders";
import { IMAGE_ACCEPT_ATTR } from "@/lib/storage-constants";
import { validateImageFileClient } from "@/lib/client-image-upload";

type DocKind = "front" | "back" | "selfie";
type DocType = "passport" | "national_id" | "driving_licence";

type VerificationPayload = {
  status: string;
  identityVerified: boolean;
  request: {
    id: string;
    status: string;
    documentType: string;
    rejectionReason: string;
    documents: Array<{ id: string; kind: string; uploaded: boolean }>;
  } | null;
  /** False when private document storage isn't configured (e.g. missing BLOB_PRIVATE_READ_WRITE_TOKEN on Vercel). */
  storageAvailable?: boolean;
};

const DOC_TYPES: Array<{ value: DocType; label: string }> = [
  { value: "passport", label: "Passport" },
  { value: "national_id", label: "National ID" },
  { value: "driving_licence", label: "Driving licence" },
];

export default function IdentityVerificationPage() {
  const router = useRouter();
  const { account, signedIn, authReady, showToast, refreshAccount } =
    useAppUi();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<DocKind | null>(null);
  const [data, setData] = useState<VerificationPayload | null>(null);
  const [documentType, setDocumentType] = useState<DocType>("passport");
  const [notes, setNotes] = useState("");
  const [uploadErrors, setUploadErrors] = useState<
    Partial<Record<DocKind, string>>
  >({});
  const lastFilesRef = useRef<Partial<Record<DocKind, File>>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/verification");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json as VerificationPayload);
      if (json.request?.documentType) {
        setDocumentType(json.request.documentType as DocType);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (authReady && !signedIn) {
      router.replace("/sign-in");
    }
  }, [authReady, signedIn, router]);

  useEffect(() => {
    if (authReady && signedIn) void load();
  }, [authReady, signedIn, load]);

  const uploadedKinds = useMemo(() => {
    const set = new Set<string>();
    for (const d of data?.request?.documents || []) set.add(d.kind);
    return set;
  }, [data]);

  const needsBack = documentType !== "passport";
  const canSubmit =
    uploadedKinds.has("front") &&
    uploadedKinds.has("selfie") &&
    (!needsBack || uploadedKinds.has("back"));

  async function startOrUpdateRequest() {
    setBusy(true);
    try {
      const res = await fetch("/api/verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentType, notes }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not start request");
      setData((prev) =>
        prev
          ? {
              ...prev,
              status: json.request?.status || "DRAFT",
              request: json.request,
            }
          : {
              status: json.request?.status || "DRAFT",
              identityVerified: false,
              request: json.request,
            },
      );
      await refreshAccount();
      showToast("Verification request saved — upload your documents");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function uploadKind(kind: DocKind, file: File | null) {
    if (!file) return;
    const err = validateImageFileClient(file);
    if (err) {
      setUploadErrors((prev) => ({ ...prev, [kind]: err }));
      showToast(err);
      return;
    }
    lastFilesRef.current[kind] = file;
    setUploadErrors((prev) => ({ ...prev, [kind]: undefined }));
    setUploading(kind);
    try {
      let requestId = data?.request?.id;
      if (!requestId) {
        const createRes = await fetch("/api/verification", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentType, notes }),
        });
        const createJson = await createRes.json().catch(() => ({}));
        if (!createRes.ok) {
          throw new Error(createJson.error || "Could not start request");
        }
        requestId = createJson.request?.id as string;
        setData({
          status: createJson.request?.status || "DRAFT",
          identityVerified: false,
          request: createJson.request,
        });
      }

      const form = new FormData();
      form.append("file", file);
      form.append("kind", kind);
      if (requestId) form.append("requestId", requestId);

      const res = await fetch("/api/verification/documents", {
        method: "POST",
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Upload failed");
      setData({
        status: json.request?.status || "DRAFT",
        identityVerified: false,
        request: json.request,
      });
      await refreshAccount();
      setUploadErrors((prev) => ({ ...prev, [kind]: undefined }));
      showToast(
        kind === "selfie"
          ? "Selfie uploaded securely"
          : `${kind === "front" ? "Front" : "Back"} uploaded securely`,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "Upload failed";
      setUploadErrors((prev) => ({ ...prev, [kind]: message }));
      showToast(message);
    } finally {
      setUploading(null);
    }
  }

  function retryUpload(kind: DocKind) {
    const file = lastFilesRef.current[kind];
    if (file) void uploadKind(kind, file);
  }

  async function removeDocument(kind: DocKind, documentId?: string) {
    if (!documentId) return;
    setUploading(kind);
    try {
      const res = await fetch(`/api/verification/documents/${documentId}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not remove document");
      setData((prev) =>
        prev
          ? { ...prev, request: json.request || prev.request }
          : prev,
      );
      setUploadErrors((prev) => ({ ...prev, [kind]: undefined }));
      showToast("Document removed");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not remove document");
    } finally {
      setUploading(null);
    }
  }

  async function submitRequest() {
    if (!data?.request?.id) return;
    setBusy(true);
    try {
      const res = await fetch("/api/verification/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: data.request.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not submit request");
      await load();
      await refreshAccount();
      showToast("Verification request submitted for review");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not submit request");
    } finally {
      setBusy(false);
    }
  }

  if (!authReady || !account || loading) {
    return (
      <div className="bg-app-navy min-h-[100svh] pt-28 pb-20 text-white">
        <Container className="max-w-xl">
          <p className="text-white/50">Loading…</p>
        </Container>
      </div>
    );
  }

  const status = (
    data?.status ||
    account.identityVerificationStatus ||
    (account.identityVerified ? "VERIFIED" : "UNVERIFIED")
  ).toUpperCase();
  const verified = Boolean(data?.identityVerified || account.identityVerified);
  const pending = status === "PENDING";
  const rejected = status === "REJECTED";
  const isAdminViewer = account.role === "ADMIN" || Boolean(account.isAdmin);
  const storageUnavailable = data?.storageAvailable === false;

  return (
    <div className="bg-app-navy min-h-[100svh] pt-28 pb-24 text-white">
      <Container className="max-w-xl">
        <nav className="mb-8 text-xs uppercase tracking-[0.14em] text-white/45">
          <Link href="/profile/settings" className="hover:text-white">
            Account Settings
          </Link>
          <span className="mx-2">/</span>
          <span className="text-white/80">Identity verification</span>
        </nav>

        <h1 className="font-display text-4xl text-white">Identity verification</h1>
        <p className="mt-3 text-sm leading-relaxed text-white/55">
          Upload government ID documents for review. Verification is never
          automatic — a Source Bridge admin must approve before your Verified
          badge appears.
        </p>

        <div className="mt-6 inline-flex items-center rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-white/70">
          Status: {verified ? "VERIFIED" : status}
        </div>

        {verified ? (
          <section className="panel-navy mt-8 rounded-xl px-5 py-6">
            <p className="text-sm text-white/75">
              Your identity is verified. The Verified badge is visible on your
              public profile.
            </p>
            <Link
              href="/profile/settings"
              className="mt-5 inline-block text-xs uppercase tracking-[0.14em] text-electric hover:text-electric-hover"
            >
              Back to settings
            </Link>
          </section>
        ) : storageUnavailable ? (
          isAdminViewer ? (
            <section className="panel-navy mt-8 rounded-xl border border-amber-400/30 bg-amber-400/10 px-5 py-6 text-sm text-amber-100">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-200">
                Storage not configured
              </p>
              <p className="mt-3 leading-relaxed">
                Identity document uploads are disabled because private
                storage isn&apos;t configured for this environment. Create a{" "}
                <strong>Private</strong> Vercel Blob store and set the{" "}
                <code className="rounded bg-black/25 px-1 py-0.5 text-[13px]">
                  BLOB_PRIVATE_READ_WRITE_TOKEN
                </code>{" "}
                environment variable on this project, then redeploy.
              </p>
              <p className="mt-2 text-xs text-amber-100/70">
                You&apos;re seeing this detailed message because your account
                has admin access. Other users see a generic
                &quot;temporarily unavailable&quot; notice instead.
              </p>
            </section>
          ) : (
            <section className="panel-navy mt-8 rounded-xl px-5 py-6 text-sm text-white/70">
              Identity verification is temporarily unavailable. Please try
              again later.
            </section>
          )
        ) : (
          <>
            {rejected && data?.request?.rejectionReason ? (
              <section className="mt-8 rounded-xl border border-amber-400/30 bg-amber-400/10 px-5 py-4 text-sm text-amber-100">
                Previous request rejected: {data.request.rejectionReason}. You
                can upload new documents to resubmit.
              </section>
            ) : null}

            <section className="panel-navy mt-8 rounded-xl px-5 py-6 sm:px-6">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
                Document type
              </h2>
              <div className="mt-4 space-y-2">
                {DOC_TYPES.map((opt) => {
                  const active = documentType === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={busy}
                      onClick={() => setDocumentType(opt.value)}
                      className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                        active
                          ? "border-electric/50 bg-electric/10 text-white"
                          : "border-white/15 text-white/70 hover:border-white/30"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <label className="mt-5 block">
                <span className="text-xs uppercase tracking-[0.14em] text-white/45">
                  Notes (optional)
                </span>
                <textarea
                  className="mt-2 w-full rounded-lg border border-white/15 bg-transparent px-3 py-2.5 text-sm text-white outline-none focus:border-electric/50"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything reviewers should know"
                />
              </label>

              <div className="mt-5">
                <PrimaryButton
                  type="button"
                  showArrow={false}
                  disabled={busy}
                  onClick={() => void startOrUpdateRequest()}
                  className="rounded-lg"
                >
                  {busy
                    ? "Saving…"
                    : data?.request
                      ? "Update request"
                      : "Start verification request"}
                </PrimaryButton>
              </div>
            </section>

            <section className="panel-navy mt-6 rounded-xl px-5 py-6 sm:px-6">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
                Secure document uploads
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-white/50">
                Images are stored privately via Vercel Blob and are never shown
                on public profiles. Only admins can review them.
              </p>

              <div className="mt-5 space-y-4">
                <UploadSlot
                  label={
                    documentType === "passport"
                      ? "Passport identity page"
                      : "Front of document"
                  }
                  kind="front"
                  done={uploadedKinds.has("front")}
                  documentId={
                    data?.request?.documents.find((d) => d.kind === "front")?.id
                  }
                  busy={uploading === "front"}
                  locked={pending || data?.request?.status === "PENDING"}
                  error={uploadErrors.front}
                  onFile={(f) => void uploadKind("front", f)}
                  onRetry={() => retryUpload("front")}
                  onRemove={() =>
                    void removeDocument(
                      "front",
                      data?.request?.documents.find((d) => d.kind === "front")
                        ?.id,
                    )
                  }
                />
                {needsBack ? (
                  <UploadSlot
                    label="Back of document"
                    kind="back"
                    done={uploadedKinds.has("back")}
                    documentId={
                      data?.request?.documents.find((d) => d.kind === "back")
                        ?.id
                    }
                    busy={uploading === "back"}
                    locked={pending || data?.request?.status === "PENDING"}
                    error={uploadErrors.back}
                    onFile={(f) => void uploadKind("back", f)}
                    onRetry={() => retryUpload("back")}
                    onRemove={() =>
                      void removeDocument(
                        "back",
                        data?.request?.documents.find((d) => d.kind === "back")
                          ?.id,
                      )
                    }
                  />
                ) : null}
                <UploadSlot
                  label="Selfie holding document"
                  kind="selfie"
                  done={uploadedKinds.has("selfie")}
                  documentId={
                    data?.request?.documents.find((d) => d.kind === "selfie")
                      ?.id
                  }
                  busy={uploading === "selfie"}
                  locked={pending || data?.request?.status === "PENDING"}
                  capture="user"
                  error={uploadErrors.selfie}
                  onFile={(f) => void uploadKind("selfie", f)}
                  onRetry={() => retryUpload("selfie")}
                  onRemove={() =>
                    void removeDocument(
                      "selfie",
                      data?.request?.documents.find((d) => d.kind === "selfie")
                        ?.id,
                    )
                  }
                />
              </div>

              {data?.request?.status === "PENDING" || pending ? (
                <p className="mt-5 text-sm text-amber-200/90">
                  Verification pending. Documents are locked until review
                  completes. Your Verified badge will not appear until an
                  administrator approves your request.
                </p>
              ) : (
                <p className="mt-5 text-sm text-white/60">
                  {canSubmit
                    ? "All required images uploaded. Submit for review when ready."
                    : "Upload every required image before submitting."}
                </p>
              )}
              {canSubmit && data?.request?.status === "DRAFT" ? (
                <PrimaryButton
                  type="button"
                  showArrow={false}
                  disabled={busy}
                  onClick={() => void submitRequest()}
                  className="mt-4 rounded-lg"
                >
                  {busy ? "Submitting…" : "Submit for review"}
                </PrimaryButton>
              ) : null}
            </section>
          </>
        )}
      </Container>
    </div>
  );
}

function UploadSlot({
  label,
  kind,
  done,
  documentId,
  busy,
  locked,
  capture,
  error,
  onFile,
  onRetry,
  onRemove,
}: {
  label: string;
  kind: DocKind;
  done: boolean;
  documentId?: string;
  busy: boolean;
  locked?: boolean;
  capture?: "user" | "environment";
  error?: string | null;
  onFile: (file: File | null) => void;
  onRetry?: () => void;
  onRemove?: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const displaySrc =
    preview ||
    (done && documentId
      ? `/api/verification/documents/${documentId}/file`
      : null);

  return (
    <div
      aria-labelledby={`upload-slot-${kind}-label`}
      className={`rounded-lg border px-4 py-3 transition-colors ${
        error
          ? "border-red-400/40 bg-red-400/[0.04]"
          : done
            ? "border-emerald-400/25 bg-emerald-400/[0.03]"
            : "border-white/10"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p id={`upload-slot-${kind}-label`} className="text-sm text-white">
            {label}
          </p>
          <p
            className={`mt-0.5 text-[10px] uppercase tracking-[0.12em] ${
              error
                ? "text-red-300"
                : done
                  ? "text-emerald-300/80"
                  : "text-white/40"
            }`}
          >
            {busy
              ? "Uploading…"
              : error
                ? "Upload failed"
                : done
                  ? "Uploaded (private)"
                  : "Required"}
          </p>
        </div>
        {!locked ? (
          <div className="flex flex-wrap items-center gap-2">
            {error && onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                disabled={busy}
                className="inline-flex items-center rounded-lg border border-red-400/40 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.14em] text-red-200 hover:border-red-300 disabled:opacity-50"
              >
                Retry
              </button>
            ) : null}
            <label className="inline-flex cursor-pointer items-center rounded-lg border border-white/20 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.14em] text-white/80 hover:border-electric/40">
              {busy ? "Uploading…" : done ? "Replace" : "Upload"}
              <input
                type="file"
                accept={IMAGE_ACCEPT_ATTR}
                capture={capture}
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  if (file) {
                    if (preview) URL.revokeObjectURL(preview);
                    setPreview(URL.createObjectURL(file));
                  }
                  onFile(file);
                  e.target.value = "";
                }}
              />
            </label>
            {done && onRemove ? (
              <button
                type="button"
                onClick={onRemove}
                disabled={busy}
                className="inline-flex items-center rounded-lg border border-white/15 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.14em] text-white/60 hover:border-red-300/50 hover:text-red-200 disabled:opacity-50"
              >
                Remove
              </button>
            ) : null}
          </div>
        ) : (
          <span className="text-[10px] uppercase tracking-[0.12em] text-white/35">
            Locked
          </span>
        )}
      </div>
      {busy ? (
        <div
          role="progressbar"
          aria-label={`${label} uploading`}
          className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/10"
        >
          <div className="h-full w-full animate-pulse rounded-full bg-electric/70" />
        </div>
      ) : null}
      {error ? <p className="mt-2 text-xs text-red-300/90">{error}</p> : null}
      {displaySrc ? (
        <div className="relative mt-3 aspect-[4/3] overflow-hidden rounded-lg bg-black/30">
          {/* Local preview or authenticated stream — never a permanent storage URL. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={displaySrc}
            alt=""
            className="h-full w-full object-contain"
          />
        </div>
      ) : null}
      <span className="sr-only">{kind}</span>
    </div>
  );
}

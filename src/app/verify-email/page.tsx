"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useAppUi } from "@/components/providers/AppProviders";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { refreshAccount, showToast } = useAppUi();
  const [status, setStatus] = useState<"working" | "ok" | "error">("working");
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get("token")?.trim() || "";
    if (!token) {
      setStatus("error");
      setError("Missing verification token.");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = (await res.json()) as {
          error?: string;
          code?: string;
          next?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setStatus("error");
          setError(data.error || "Could not verify email");
          setCode(data.code || null);
          return;
        }
        await refreshAccount();
        setStatus("ok");
        showToast("Email verified");
        router.replace(data.next || "/onboarding");
      } catch {
        if (!cancelled) {
          setStatus("error");
          setError("Could not verify email");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, refreshAccount, router, showToast]);

  return (
    <Container className="max-w-lg">
      {status === "working" ? (
        <>
          <h1 className="text-4xl font-bold tracking-tight text-white">
            Verifying…
          </h1>
          <p className="mt-4 text-white/60">
            Confirming your email. This only takes a moment.
          </p>
        </>
      ) : null}

      {status === "ok" ? (
        <>
          <h1 className="text-4xl font-bold tracking-tight text-white">
            Email verified
          </h1>
          <p className="mt-4 text-white/60">Taking you to onboarding…</p>
        </>
      ) : null}

      {status === "error" ? (
        <div className="panel-navy rounded-xl px-5 py-6 sm:px-6">
          <h1 className="text-3xl font-bold tracking-tight text-white">
            {code === "TOKEN_USED"
              ? "Link already used"
              : code === "TOKEN_EXPIRED"
                ? "Link expired"
                : "Verification failed"}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-white/60">
            {error}
            {code === "TOKEN_EXPIRED"
              ? " Request a new link from the check-email screen."
              : code === "TOKEN_USED"
                ? " If you're already verified, continue to onboarding or sign in."
                : ""}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <PrimaryButton href="/check-email" showArrow={false}>
              Check email
            </PrimaryButton>
            <Link
              href="/sign-in"
              className="inline-flex h-12 items-center rounded-lg border border-white/15 px-5 text-sm font-medium text-white/80 hover:border-electric/40"
            >
              Sign in
            </Link>
          </div>
        </div>
      ) : null}
    </Container>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="bg-app-navy min-h-[100svh] pt-28 pb-20 text-white sm:pt-32 sm:pb-28">
      <Suspense
        fallback={
          <Container className="max-w-lg">
            <p className="text-white/50">Loading…</p>
          </Container>
        }
      >
        <VerifyEmailContent />
      </Suspense>
    </div>
  );
}

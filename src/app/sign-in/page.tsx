"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useAppUi } from "@/components/providers/AppProviders";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, signedIn, account, authReady } = useAppUi();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!authReady || !signedIn || !account) return;
    if (!account.emailVerified) {
      router.replace("/check-email");
      return;
    }
    if (!account.onboardingComplete) {
      router.replace("/onboarding");
      return;
    }
    const next = searchParams.get("next");
    router.replace(next || "/explore");
  }, [authReady, signedIn, account, router, searchParams]);

  if (!authReady || (signedIn && account)) {
    return (
      <Container className="max-w-md">
        <p className="text-white/50">
          {!authReady ? "Loading…" : "Redirecting…"}
        </p>
      </Container>
    );
  }

  return (
    <Container className="max-w-md">
      <h1 className="text-4xl font-bold tracking-tight text-white">Sign in</h1>
      <p className="mt-3 text-white/60">
        Enter your email or username and password to continue.
      </p>

      <form
        className="panel-navy mt-10 space-y-4 rounded-xl px-5 py-6 sm:px-6"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!identifier.trim() || !password || submitting) return;
          setSubmitting(true);
          try {
            await signIn({ identifier: identifier.trim(), password });
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <label className="block text-xs uppercase tracking-[0.14em] text-white/45">
          Email or username
          <input
            required
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            className="input-navy mt-1.5 h-12 w-full rounded-lg px-4 text-sm"
            autoComplete="username"
          />
        </label>
        <label className="block text-xs uppercase tracking-[0.14em] text-white/45">
          Password
          <input
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-navy mt-1.5 h-12 w-full rounded-lg px-4 text-sm"
            autoComplete="current-password"
          />
        </label>
        <div className="flex justify-end">
          <Link
            href="/set-password"
            className="text-xs text-white/45 underline-offset-2 hover:text-white hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <PrimaryButton
          type="submit"
          showArrow={false}
          disabled={submitting}
          className="w-full"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </PrimaryButton>
      </form>

      <p className="mt-6 text-sm text-white/50">
        New here?{" "}
        <Link
          href="/join"
          className="text-electric underline-offset-2 hover:underline"
        >
          Join Source Bridge
        </Link>
      </p>
    </Container>
  );
}

export default function SignInPage() {
  return (
    <div className="bg-app-navy min-h-[100svh] pt-28 pb-20 text-white sm:pt-32 sm:pb-28">
      <Suspense
        fallback={
          <Container className="max-w-md">
            <p className="text-white/50">Loading…</p>
          </Container>
        }
      >
        <SignInForm />
      </Suspense>
    </div>
  );
}

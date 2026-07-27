"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useAppUi } from "@/components/providers/AppProviders";

export default function SignInPage() {
  const router = useRouter();
  const { signIn, signedIn, account, authReady } = useAppUi();
  const [email, setEmail] = useState("");
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
    router.replace("/explore");
  }, [authReady, signedIn, account, router]);

  if (!authReady || (signedIn && account)) {
    return (
      <div className="bg-app-navy min-h-[100svh] pt-28 pb-20 text-white">
        <Container className="max-w-md">
          <p className="text-white/50">
            {!authReady ? "Loading…" : "Redirecting…"}
          </p>
        </Container>
      </div>
    );
  }

  return (
    <div className="bg-app-navy min-h-[100svh] pt-28 pb-20 text-white sm:pt-32 sm:pb-28">
      <Container className="max-w-md">
        <h1 className="text-4xl font-bold tracking-tight text-white">Sign in</h1>
        <p className="mt-3 text-white/60">
          Enter the email you used to join. No password — we keep you signed in
          via a secure session.
        </p>

        <form
          className="panel-navy mt-10 space-y-4 rounded-xl px-5 py-6 sm:px-6"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!email.trim() || submitting) return;
            setSubmitting(true);
            try {
              await signIn({ email: email.trim() });
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <label className="block text-xs uppercase tracking-[0.14em] text-white/45">
            Email
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-navy mt-1.5 h-12 w-full rounded-lg px-4 text-sm"
              autoComplete="email"
            />
          </label>
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
    </div>
  );
}

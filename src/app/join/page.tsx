"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useAppUi } from "@/components/providers/AppProviders";
import type { AccountIntent } from "@/lib/types";

const intents: { id: AccountIntent; title: string; copy: string }[] = [
  {
    id: "buyer",
    title: "Find help",
    copy: "I need someone somewhere — or going somewhere — to help me source, inspect, or carry.",
  },
  {
    id: "provider",
    title: "Offer help",
    copy: "I'm local, travelling, or specialised — and I can create value for others from where I am.",
  },
  {
    id: "both",
    title: "Both",
    copy: "I want to find help and offer help. One shared account — expand either way later.",
  },
];

function parseIntent(value: string | null): AccountIntent | null {
  if (value === "buyer" || value === "provider" || value === "both") return value;
  return null;
}

function JoinForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { join, signedIn, account, authReady } = useAppUi();
  const [intent, setIntent] = useState<AccountIntent>("both");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fromQuery = parseIntent(searchParams.get("intent"));
    if (fromQuery) setIntent(fromQuery);
  }, [searchParams]);

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

  if (!authReady) {
    return (
      <Container className="max-w-2xl">
        <p className="text-white/50">Loading…</p>
      </Container>
    );
  }

  if (signedIn && account) {
    return (
      <Container className="max-w-2xl">
        <p className="text-white/50">Redirecting…</p>
      </Container>
    );
  }

  return (
    <Container className="max-w-2xl">
      <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
        Join Source Bridge
      </h1>
      <p className="mt-4 text-white/60">
        One shared account. Choose how you want to start — you can expand later.
      </p>

      <div className="mt-10 grid gap-3">
        {intents.map((option) => {
          const active = intent === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setIntent(option.id)}
              className={`rounded-xl border p-5 text-left transition-colors ${
                active
                  ? "border-electric bg-electric/15 shadow-[0_0_0_1px_rgba(59,130,246,0.25)]"
                  : "border-white/10 bg-white/[0.03] hover:border-electric/40"
              }`}
            >
              <p className="text-xl font-semibold tracking-tight text-white">
                {option.title}
              </p>
              <p className="mt-2 text-sm text-white/55">{option.copy}</p>
            </button>
          );
        })}
      </div>

      <form
        className="panel-navy mt-10 space-y-4 rounded-xl px-5 py-6 sm:px-6"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || !email.trim() || submitting) return;
          setSubmitting(true);
          try {
            await join({
              name: name.trim(),
              email: email.trim(),
              intent,
            });
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <label className="block text-xs uppercase tracking-[0.14em] text-white/45">
          Full name
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-navy mt-1.5 h-12 w-full rounded-lg px-4 text-sm"
            autoComplete="name"
          />
        </label>
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
          className="w-full sm:w-auto"
        >
          {submitting ? "Creating…" : "Create account"}
        </PrimaryButton>
      </form>

      <p className="mt-6 text-sm text-white/50">
        Already have an account?{" "}
        <Link
          href="/sign-in"
          className="text-electric underline-offset-2 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </Container>
  );
}

export default function JoinPage() {
  return (
    <div className="bg-app-navy min-h-[100svh] pt-28 pb-20 text-white sm:pt-32 sm:pb-28">
      <Suspense
        fallback={
          <Container className="max-w-2xl">
            <p className="text-white/50">Loading…</p>
          </Container>
        }
      >
        <JoinForm />
      </Suspense>
    </div>
  );
}

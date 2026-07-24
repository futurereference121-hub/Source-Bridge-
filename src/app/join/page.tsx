"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
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
    copy: "I’m local, travelling, or specialised — and I can create value for others from where I am.",
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
  const { join, signedIn, account } = useAppUi();
  const [intent, setIntent] = useState<AccountIntent>("both");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    const fromQuery = parseIntent(searchParams.get("intent"));
    if (fromQuery) setIntent(fromQuery);
  }, [searchParams]);

  if (signedIn && account) {
    return (
      <Container className="max-w-lg text-center">
        <h1 className="text-4xl font-bold tracking-tight text-navy">You’re in</h1>
        <p className="mt-3 text-muted">
          Signed in as {account.name}. Intent: {account.intent}.
        </p>
        <Button href="/explore" className="mt-8" size="lg">
          Go to Explore
        </Button>
      </Container>
    );
  }

  return (
    <Container className="max-w-2xl">
      <h1 className="text-4xl font-bold tracking-tight text-navy sm:text-5xl">
        How would you like to use Source Bridge?
      </h1>
      <p className="mt-4 text-muted">
        One shared account. Choose an intent now — you can expand later.
      </p>

      <div className="mt-10 grid gap-3">
        {intents.map((option) => {
          const active = intent === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setIntent(option.id)}
              className={`rounded-[6px] border p-5 text-left transition-colors ${
                active
                  ? "border-electric bg-electric-soft"
                  : "border-border bg-surface hover:border-electric/40"
              }`}
            >
              <p className="text-2xl font-semibold tracking-tight text-navy">
                {option.title}
              </p>
              <p className="mt-2 text-sm text-muted">{option.copy}</p>
            </button>
          );
        })}
      </div>

      <form
        className="mt-10 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || !email.trim()) return;
          join({ name: name.trim(), email: email.trim(), intent });
        }}
      >
        <label className="block text-xs uppercase tracking-[0.14em] text-muted">
          Full name
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5 h-12 w-full rounded-[5px] border border-border bg-surface px-4 text-sm text-navy outline-none focus:border-electric"
          />
        </label>
        <label className="block text-xs uppercase tracking-[0.14em] text-muted">
          Email
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5 h-12 w-full rounded-[5px] border border-border bg-surface px-4 text-sm text-navy outline-none focus:border-electric"
          />
        </label>
        <Button type="submit" size="lg" className="w-full sm:w-auto">
          Create account
        </Button>
      </form>

      <p className="mt-6 text-sm text-muted">
        Already have an account?{" "}
        <Link href="/sign-in" className="text-electric underline-offset-2 hover:underline">
          Sign in
        </Link>
      </p>
      <p className="mt-2 text-xs text-muted-light">
        Prototype only — saved in this browser via localStorage.
      </p>
    </Container>
  );
}

export default function JoinPage() {
  return (
    <div className="bg-background pt-28 pb-20 sm:pt-32 sm:pb-28">
      <Suspense
        fallback={
          <Container className="max-w-2xl">
            <p className="text-muted">Loading…</p>
          </Container>
        }
      >
        <JoinForm />
      </Suspense>
    </div>
  );
}

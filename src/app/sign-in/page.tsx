"use client";

import { useState } from "react";
import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { useAppUi } from "@/components/providers/AppProviders";

export default function SignInPage() {
  const { signIn, signedIn, account } = useAppUi();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  if (signedIn && account) {
    return (
      <div className="pt-28 pb-20">
        <Container className="max-w-lg text-center">
          <h1 className="font-display text-4xl text-ink">Signed in</h1>
          <p className="mt-3 text-muted">Welcome back, {account.name}.</p>
          <Button href="/profile" className="mt-8" size="lg">
            Open profile
          </Button>
        </Container>
      </div>
    );
  }

  return (
    <div className="pt-28 pb-20 sm:pt-32 sm:pb-28">
      <Container className="max-w-md">
        <h1 className="font-display text-4xl text-ink">Sign in</h1>
        <p className="mt-3 text-muted">
          Prototype stub — no password. Enter an email to continue in this browser.
        </p>

        <form
          className="mt-10 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!email.trim()) return;
            signIn({ email: email.trim(), name: name.trim() || undefined });
          }}
        >
          <label className="block text-xs uppercase tracking-[0.14em] text-muted">
            Email
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 h-12 w-full border border-border bg-surface px-4 text-sm text-ink outline-none focus:border-ink/40"
            />
          </label>
          <label className="block text-xs uppercase tracking-[0.14em] text-muted">
            Name <span className="normal-case tracking-normal">(if new)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1.5 h-12 w-full border border-border bg-surface px-4 text-sm text-ink outline-none focus:border-ink/40"
            />
          </label>
          <Button type="submit" size="lg" className="w-full">
            Sign in
          </Button>
        </form>

        <p className="mt-6 text-sm text-muted">
          New here?{" "}
          <Link href="/join" className="text-ink underline-offset-2 hover:underline">
            Join Source Bridge
          </Link>
        </p>
      </Container>
    </div>
  );
}

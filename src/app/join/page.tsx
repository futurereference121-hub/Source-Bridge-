"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useAppUi } from "@/components/providers/AppProviders";
import { passwordStrengthLevel } from "@/lib/password-strength";
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

const STRENGTH_COPY: Record<string, { label: string; className: string }> = {
  weak: { label: "Weak", className: "bg-red-400" },
  fair: { label: "Fair", className: "bg-amber-400" },
  good: { label: "Good", className: "bg-electric" },
  strong: { label: "Strong", className: "bg-emerald-400" },
};

const STRENGTH_WIDTH: Record<string, string> = {
  weak: "25%",
  fair: "50%",
  good: "75%",
  strong: "100%",
};

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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<
    "idle" | "checking" | "ok" | "taken" | "invalid"
  >("idle");
  const [usernameMsg, setUsernameMsg] = useState("");

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
    const next = searchParams.get("next");
    if (next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/admin")) {
      router.replace(next);
      return;
    }
    router.replace("/explore");
  }, [authReady, signedIn, account, router, searchParams]);

  useEffect(() => {
    const u = username.trim().toLowerCase().replace(/^@/, "");
    if (u.length < 3) {
      setUsernameStatus("idle");
      setUsernameMsg("");
      return;
    }
    setUsernameStatus("checking");
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/username/check?u=${encodeURIComponent(u)}`);
        const data = (await res.json()) as { available?: boolean; reason?: string };
        if (!res.ok) {
          setUsernameStatus("invalid");
          setUsernameMsg(data.reason || "Invalid username");
          return;
        }
        if (data.available) {
          setUsernameStatus("ok");
          setUsernameMsg("Available");
        } else {
          setUsernameStatus("taken");
          setUsernameMsg(data.reason || "Username is taken");
        }
      } catch {
        setUsernameStatus("idle");
        setUsernameMsg("");
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [username]);

  const strength = useMemo(
    () => (password ? passwordStrengthLevel(password) : null),
    [password],
  );
  const passwordsMatch = confirmPassword.length === 0 || password === confirmPassword;
  const requirementsMet =
    password.length >= 10 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password);

  const canSubmit =
    Boolean(name.trim()) &&
    Boolean(email.trim()) &&
    usernameStatus === "ok" &&
    requirementsMet &&
    password === confirmPassword &&
    !submitting;

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
          if (!canSubmit) return;
          setSubmitting(true);
          try {
            await join({
              name: name.trim(),
              email: email.trim(),
              username: username.trim().toLowerCase().replace(/^@/, ""),
              password,
              confirmPassword,
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
        <label className="block text-xs uppercase tracking-[0.14em] text-white/45">
          Username
          <div className="relative mt-1.5">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/40">
              @
            </span>
            <input
              required
              value={username}
              onChange={(e) => setUsername(e.target.value.replace(/^@/, ""))}
              className="input-navy h-12 w-full rounded-lg pl-8 pr-4 text-sm"
              autoComplete="username"
              minLength={3}
              maxLength={30}
            />
          </div>
          {usernameMsg ? (
            <p
              className={`mt-1.5 text-xs normal-case tracking-normal ${
                usernameStatus === "ok"
                  ? "text-electric"
                  : usernameStatus === "checking"
                    ? "text-white/40"
                    : "text-red-300"
              }`}
            >
              {usernameStatus === "checking" ? "Checking…" : usernameMsg}
            </p>
          ) : null}
        </label>
        <label className="block text-xs uppercase tracking-[0.14em] text-white/45">
          Password
          <input
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-navy mt-1.5 h-12 w-full rounded-lg px-4 text-sm"
            autoComplete="new-password"
            minLength={10}
          />
        </label>
        {password ? (
          <div className="space-y-2">
            {strength ? (
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full transition-all ${STRENGTH_COPY[strength].className}`}
                    style={{ width: STRENGTH_WIDTH[strength] }}
                  />
                </div>
                <span className="text-xs text-white/50">
                  {STRENGTH_COPY[strength].label}
                </span>
              </div>
            ) : null}
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-white/45">
              <li className={password.length >= 10 ? "text-electric" : undefined}>
                10+ characters
              </li>
              <li className={/\d/.test(password) ? "text-electric" : undefined}>
                A number
              </li>
              <li className={/[A-Z]/.test(password) ? "text-electric" : undefined}>
                An uppercase letter
              </li>
              <li className={/[a-z]/.test(password) ? "text-electric" : undefined}>
                A lowercase letter
              </li>
            </ul>
          </div>
        ) : null}
        <label className="block text-xs uppercase tracking-[0.14em] text-white/45">
          Confirm password
          <input
            required
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="input-navy mt-1.5 h-12 w-full rounded-lg px-4 text-sm"
            autoComplete="new-password"
            minLength={10}
          />
          {!passwordsMatch ? (
            <p className="mt-1.5 text-xs normal-case tracking-normal text-red-300">
              Passwords do not match
            </p>
          ) : null}
        </label>
        <PrimaryButton
          type="submit"
          showArrow={false}
          disabled={!canSubmit}
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

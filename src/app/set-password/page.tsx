"use client";

import { Suspense, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useAppUi } from "@/components/providers/AppProviders";
import { passwordStrengthLevel } from "@/lib/password-strength";
import type { AccountSession } from "@/lib/types";

const STRENGTH_COPY: Record<string, { label: string; className: string }> = {
  weak: { label: "Weak", className: "bg-red-400" },
  fair: { label: "Fair", className: "bg-amber-400" },
  good: { label: "Good", className: "bg-electric" },
  strong: { label: "Strong", className: "bg-emerald-400" },
};

function RequestLinkForm() {
  const searchParams = useSearchParams();
  const { showToast } = useAppUi();
  const [email, setEmail] = useState(searchParams.get("email") || "");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/request-set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        previewUrl?: string | null;
      };
      if (!res.ok) {
        showToast(data.error || "Could not send link");
        return;
      }
      setSent(true);
      setPreviewUrl(data.previewUrl || null);
    } catch {
      showToast("Could not send link");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container className="max-w-md">
      <h1 className="text-4xl font-bold tracking-tight text-white">
        Set your password
      </h1>
      <p className="mt-3 text-white/60">
        Enter your account email and we&apos;ll send you a secure link to set
        or reset your password.
      </p>

      {sent ? (
        <div className="panel-navy mt-10 space-y-4 rounded-xl px-5 py-6 sm:px-6">
          <p className="text-sm text-white/70">
            If an account exists for <span className="text-white">{email}</span>{" "}
            and its email is verified, a link is on its way. Check your inbox
            (and spam).
          </p>
          {previewUrl ? (
            <div className="space-y-2 border-t border-white/10 pt-4">
              <p className="text-xs uppercase tracking-[0.14em] text-white/45">
                Dev preview link
              </p>
              <a
                href={previewUrl}
                className="block break-all text-sm text-electric underline-offset-2 hover:underline"
              >
                {previewUrl}
              </a>
            </div>
          ) : null}
        </div>
      ) : (
        <form
          className="panel-navy mt-10 space-y-4 rounded-xl px-5 py-6 sm:px-6"
          onSubmit={submit}
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
            {submitting ? "Sending…" : "Send link"}
          </PrimaryButton>
        </form>
      )}

      <p className="mt-6 text-sm text-white/50">
        Remembered your password?{" "}
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

function SetNewPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const { showToast } = useAppUi();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const strength = useMemo(
    () => (password ? passwordStrengthLevel(password) : null),
    [password],
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        account?: AccountSession;
        next?: string;
      };
      if (!res.ok) {
        setError(data.error || "Could not set password");
        return;
      }
      showToast("Password set — you're signed in");
      router.replace(data.next || "/explore");
    } catch {
      setError("Could not set password");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container className="max-w-md">
      <h1 className="text-4xl font-bold tracking-tight text-white">
        Choose a new password
      </h1>
      <p className="mt-3 text-white/60">
        Use at least 10 characters with an uppercase letter, a lowercase
        letter, and a number.
      </p>

      <form
        className="panel-navy mt-10 space-y-4 rounded-xl px-5 py-6 sm:px-6"
        onSubmit={submit}
      >
        <label className="block text-xs uppercase tracking-[0.14em] text-white/45">
          New password
          <input
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-navy mt-1.5 h-12 w-full rounded-lg px-4 text-sm"
            autoComplete="new-password"
          />
        </label>
        {strength ? (
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full transition-all ${STRENGTH_COPY[strength].className}`}
                style={{
                  width:
                    strength === "weak"
                      ? "25%"
                      : strength === "fair"
                        ? "50%"
                        : strength === "good"
                          ? "75%"
                          : "100%",
                }}
              />
            </div>
            <span className="text-xs text-white/50">
              {STRENGTH_COPY[strength].label}
            </span>
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
          />
        </label>
        <PrimaryButton
          type="submit"
          showArrow={false}
          disabled={submitting}
          className="w-full"
        >
          {submitting ? "Saving…" : "Set password"}
        </PrimaryButton>
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
      </form>

      <p className="mt-6 text-sm text-white/50">
        Link expired or already used?{" "}
        <Link
          href="/set-password"
          className="text-electric underline-offset-2 hover:underline"
        >
          Request a new one
        </Link>
      </p>
    </Container>
  );
}

function SetPasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() || "";
  return token ? <SetNewPasswordForm token={token} /> : <RequestLinkForm />;
}

export default function SetPasswordPage() {
  return (
    <div className="bg-app-navy min-h-[100svh] pt-28 pb-20 text-white sm:pt-32 sm:pb-28">
      <Suspense
        fallback={
          <Container className="max-w-md">
            <p className="text-white/50">Loading…</p>
          </Container>
        }
      >
        <SetPasswordContent />
      </Suspense>
    </div>
  );
}

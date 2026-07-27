"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import {
  useAppUi,
  VERIFY_PREVIEW_KEY,
} from "@/components/providers/AppProviders";

export default function CheckEmailPage() {
  const router = useRouter();
  const { account, authReady, refreshAccount, showToast } = useAppUi();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [changingEmail, setChangingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailUpdated, setEmailUpdated] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem(VERIFY_PREVIEW_KEY);
    if (stored) setPreviewUrl(stored);
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!account) {
      router.replace("/join");
      return;
    }
    if (account.emailVerified) {
      router.replace(account.onboardingComplete ? "/explore" : "/onboarding");
    }
  }, [authReady, account, router]);

  async function handleResend() {
    if (resending) return;
    setResending(true);
    setResent(false);
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
      });
      const data = (await res.json()) as {
        error?: string;
        previewUrl?: string | null;
        alreadyVerified?: boolean;
      };
      if (!res.ok) {
        showToast(data.error || "Could not resend");
        return;
      }
      if (data.alreadyVerified) {
        const next = await refreshAccount();
        router.replace(
          next?.onboardingComplete ? "/explore" : "/onboarding",
        );
        return;
      }
      if (data.previewUrl) {
        sessionStorage.setItem(VERIFY_PREVIEW_KEY, data.previewUrl);
        setPreviewUrl(data.previewUrl);
      }
      setResent(true);
      showToast("Verification email resent");
    } catch {
      showToast("Could not resend");
    } finally {
      setResending(false);
    }
  }

  async function handleChangeEmail(e: FormEvent) {
    e.preventDefault();
    if (!newEmail.trim() || emailBusy) return;
    setEmailBusy(true);
    setEmailUpdated(false);
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim() }),
      });
      const data = (await res.json()) as {
        error?: string;
        previewUrl?: string | null;
        message?: string;
      };
      if (!res.ok) {
        showToast(data.error || "Could not change email");
        return;
      }
      if (data.previewUrl) {
        sessionStorage.setItem(VERIFY_PREVIEW_KEY, data.previewUrl);
        setPreviewUrl(data.previewUrl);
      }
      await refreshAccount();
      setEmailUpdated(true);
      setChangingEmail(false);
      setNewEmail("");
      showToast(data.message || "Email updated — check your inbox");
    } catch {
      showToast("Could not change email");
    } finally {
      setEmailBusy(false);
    }
  }

  async function copyPreview() {
    if (!previewUrl) return;
    try {
      await navigator.clipboard.writeText(previewUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("Could not copy link");
    }
  }

  if (!authReady || !account || account.emailVerified) {
    return (
      <div className="bg-app-navy min-h-[100svh] pt-28 pb-20 text-white">
        <Container className="max-w-lg">
          <p className="text-white/50">Loading…</p>
        </Container>
      </div>
    );
  }

  return (
    <div className="bg-app-navy min-h-[100svh] pt-28 pb-20 text-white sm:pt-32 sm:pb-28">
      <Container className="max-w-lg">
        <h1 className="text-4xl font-bold tracking-tight text-white">
          Check your email
        </h1>
        <p className="mt-4 text-white/60">
          We sent a verification link to{" "}
          <span className="text-white">{account.email}</span>. Open it to
          continue setting up your profile.
        </p>

        <div className="panel-navy mt-10 space-y-5 rounded-xl px-5 py-6 sm:px-6">
          {previewUrl ? (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.14em] text-white/45">
                Dev preview link
              </p>
              <a
                href={previewUrl}
                className="block break-all text-sm text-electric underline-offset-2 hover:underline"
              >
                {previewUrl}
              </a>
              <button
                type="button"
                onClick={copyPreview}
                className="text-xs text-white/50 underline-offset-2 hover:text-white hover:underline"
              >
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          ) : (
            <p className="text-sm text-white/50">
              Check your inbox (and spam). The link expires in 24 hours.
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <PrimaryButton
              type="button"
              showArrow={false}
              disabled={resending}
              onClick={handleResend}
            >
              {resending ? "Sending…" : resent ? "Resent" : "Resend email"}
            </PrimaryButton>
            <button
              type="button"
              onClick={() => setChangingEmail((v) => !v)}
              className="inline-flex h-12 items-center rounded-lg border border-white/15 px-5 text-sm font-medium text-white/80 hover:border-electric/40 hover:text-white"
            >
              Change email
            </button>
          </div>

          {resent ? (
            <p className="text-sm text-electric">Verification email resent.</p>
          ) : null}
          {emailUpdated ? (
            <p className="text-sm text-electric">
              Email updated — check your inbox.
            </p>
          ) : null}

          {changingEmail ? (
            <form className="space-y-3 border-t border-white/10 pt-5" onSubmit={handleChangeEmail}>
              <label className="block text-xs uppercase tracking-[0.14em] text-white/45">
                New email
                <input
                  required
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="input-navy mt-1.5 h-11 w-full rounded-lg px-4 text-sm"
                  autoComplete="email"
                />
              </label>
              <PrimaryButton
                type="submit"
                showArrow={false}
                disabled={emailBusy}
              >
                {emailBusy ? "Updating…" : "Update & resend"}
              </PrimaryButton>
            </form>
          ) : null}
        </div>

        <p className="mt-8 text-sm text-white/45">
          Wrong account?{" "}
          <Link
            href="/sign-in"
            className="text-electric underline-offset-2 hover:underline"
          >
            Sign in with a different email
          </Link>
        </p>
      </Container>
    </div>
  );
}

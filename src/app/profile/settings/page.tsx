"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { CheckCircle2, Mail, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useAppUi } from "@/components/providers/AppProviders";
import { PaymentMethodsEditor } from "@/components/profile/editors/PaymentMethodsEditor";

export default function AccountSettingsPage() {
  const router = useRouter();
  const { account, signedIn, authReady, signOut } = useAppUi();

  useEffect(() => {
    if (authReady && !signedIn) {
      router.replace("/sign-in");
    }
  }, [authReady, signedIn, router]);

  if (!authReady || !account) {
    return (
      <div className="bg-app-navy min-h-[100svh] pt-28 pb-20 text-white">
        <Container className="max-w-lg">
          <p className="text-white/50">Loading…</p>
        </Container>
      </div>
    );
  }

  return (
    <div className="bg-app-navy min-h-[100svh] pt-28 pb-24 text-white">
      <Container className="max-w-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
          Account Settings
        </p>
        <h1 className="mt-2 font-display text-4xl text-white">
          {account.username ? `@${account.username}` : account.name}
        </h1>
        <p className="mt-2 text-white/55">
          Manage your login, verification, and session.
        </p>

        <section className="panel-navy mt-10 rounded-xl px-5 py-6 sm:px-6">
          <SectionTitle>Email</SectionTitle>
          <div className="mt-4 flex items-start gap-3">
            <Mail size={18} strokeWidth={1.75} className="mt-0.5 text-white/45" />
            <div className="min-w-0">
              <p className="truncate text-sm text-white">{account.email}</p>
              <p className="mt-1 text-xs text-white/45">
                Used to sign in and receive notifications.
              </p>
            </div>
          </div>
          {!account.emailVerified ? (
            <div className="mt-5">
              <PrimaryButton href="/check-email" showArrow={false} className="rounded-lg">
                Verify email
              </PrimaryButton>
            </div>
          ) : null}
        </section>

        <section className="panel-navy mt-6 rounded-xl px-5 py-6 sm:px-6">
          <SectionTitle>Verification</SectionTitle>

          <StatusRow
            icon={
              account.emailVerified ? (
                <CheckCircle2 size={18} strokeWidth={1.75} className="mt-0.5 text-emerald-400" />
              ) : (
                <ShieldQuestion size={18} strokeWidth={1.75} className="mt-0.5 text-amber-400" />
              )
            }
            title="Email verified"
            status={account.emailVerified ? "Verified" : "Not verified"}
            statusTone={account.emailVerified ? "good" : "warn"}
            detail={
              account.emailVerified
                ? "Your email address is confirmed. Email verification is separate from identity verification and does not grant a Verified badge."
                : "Confirm your email to finish setting up your account. This does not grant a Verified badge."
            }
          />

          <div className="mt-5 border-t border-white/10 pt-5">
            <StatusRow
              icon={
                account.identityVerified ? (
                  <ShieldCheck size={18} strokeWidth={1.75} className="mt-0.5 text-electric" />
                ) : (
                  <ShieldCheck size={18} strokeWidth={1.75} className="mt-0.5 text-white/35" />
                )
              }
              title="Identity verified"
              status={account.identityVerified ? "Verified" : "Not verified"}
              statusTone={account.identityVerified ? "good" : "muted"}
              detail="The Verified badge reflects identity verification only. It is reviewed and granted by Source Bridge — it cannot be self-verified or enabled from settings."
            />
          </div>
        </section>

        <section
          id="payment-methods"
          className="panel-navy mt-6 scroll-mt-28 rounded-xl px-5 py-6 sm:px-6"
        >
          <PaymentMethodsEditor />
        </section>

        <section className="panel-navy mt-6 rounded-xl px-5 py-6 sm:px-6">
          <SectionTitle>Session</SectionTitle>
          <p className="mt-3 text-sm text-white/55">
            Sign out of Source Bridge on this device.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex h-11 items-center rounded-lg border border-white/20 px-5 text-xs font-medium uppercase tracking-[0.14em] text-white/85 transition-colors hover:border-electric/40 hover:text-white"
            >
              Sign Out
            </button>
            <Link
              href="/profile"
              className="text-xs uppercase tracking-[0.14em] text-white/45 transition-colors hover:text-white"
            >
              Back to profile
            </Link>
          </div>
        </section>
      </Container>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
      {children}
    </h2>
  );
}

function StatusRow({
  icon,
  title,
  status,
  statusTone,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  status: string;
  statusTone: "good" | "warn" | "muted";
  detail: string;
}) {
  const toneClass =
    statusTone === "good"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
      : statusTone === "warn"
        ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
        : "border-white/15 bg-white/[0.04] text-white/55";
  return (
    <div className="flex items-start gap-3">
      {icon}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-white">{title}</p>
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] ${toneClass}`}
          >
            {status}
          </span>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-white/50">{detail}</p>
      </div>
    </div>
  );
}

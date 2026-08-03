"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Bell,
  CheckCircle2,
  KeyRound,
  Mail,
  ShieldCheck,
  ShieldQuestion,
  Trash2,
  Volume2,
} from "lucide-react";
import { Container } from "@/components/ui/Container";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useAppUi } from "@/components/providers/AppProviders";
import { PaymentMethodsEditor } from "@/components/profile/editors/PaymentMethodsEditor";
import { passwordStrengthLevel } from "@/lib/password-strength";
import { playTestNotificationSound } from "@/lib/notification-sounds";

export default function AccountSettingsPage() {
  const router = useRouter();
  const { account, signedIn, authReady, signOut, refreshAccount, showToast } = useAppUi();

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

  const isAdminAccount =
    account.role === "ADMIN" ||
    Boolean(account.isAdmin) ||
    (account.username || "").toLowerCase() === "adminsource";

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
              status={
                account.identityVerified
                  ? "Verified"
                  : (account.identityVerificationStatus || "UNVERIFIED").toUpperCase() ===
                      "PENDING"
                    ? "Pending review"
                    : (account.identityVerificationStatus || "").toUpperCase() ===
                        "REJECTED"
                      ? "Rejected"
                      : "Not verified"
              }
              statusTone={
                account.identityVerified
                  ? "good"
                  : (account.identityVerificationStatus || "").toUpperCase() ===
                      "PENDING"
                    ? "warn"
                    : "muted"
              }
              detail="The Verified badge appears only after Source Bridge approves your identity documents. Completing onboarding or verifying email never grants the badge."
            />
            {!account.identityVerified ? (
              <div className="mt-5">
                <PrimaryButton
                  href="/profile/settings/verification"
                  showArrow={false}
                  className="rounded-lg"
                >
                  {(account.identityVerificationStatus || "").toUpperCase() ===
                  "PENDING"
                    ? "View verification request"
                    : "Request Verification"}
                </PrimaryButton>
              </div>
            ) : null}
          </div>
        </section>

        <section
          id="notifications"
          className="panel-navy mt-6 scroll-mt-28 rounded-xl px-5 py-6 sm:px-6"
        >
          <NotificationSoundSettings
            soundsEnabled={account.notificationSoundsEnabled ?? true}
            volume={account.notificationVolume || "medium"}
            refreshAccount={refreshAccount}
            showToast={showToast}
          />
        </section>

        <section
          id="payments"
          className="panel-navy mt-6 scroll-mt-28 rounded-xl px-5 py-6 sm:px-6"
        >
          <SectionTitle>Payments & Payouts</SectionTitle>
          <p className="mt-2 text-sm text-white/55">
            Set up Stripe Connect to receive Protected Payments. Source Bridge
            controls release timing; Stripe processes the charge.
          </p>
          <div className="mt-4">
            <PrimaryButton
              href="/profile/settings/payments"
              showArrow={false}
              className="rounded-lg"
            >
              Open Payments & Payouts
            </PrimaryButton>
          </div>
        </section>

        <section
          id="payment-methods"
          className="panel-navy mt-6 scroll-mt-28 rounded-xl px-5 py-6 sm:px-6"
        >
          <SectionTitle>Crypto payment methods</SectionTitle>
          <PaymentMethodsEditor />
        </section>

        <section
          id="password"
          className="panel-navy mt-6 scroll-mt-28 rounded-xl px-5 py-6 sm:px-6"
        >
          <PasswordSection
            hasPassword={Boolean(account.hasPassword)}
            emailVerified={account.emailVerified}
            refreshAccount={refreshAccount}
            showToast={showToast}
          />
        </section>

        {!isAdminAccount ? (
          <DeleteAccountSection hasPassword={Boolean(account.hasPassword)} />
        ) : null}

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

const VOLUME_OPTIONS: { value: "low" | "medium" | "high"; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const TEST_SOUNDS: { kind: "opportunity" | "status" | "message"; label: string }[] = [
  { kind: "opportunity", label: "Opportunity" },
  { kind: "status", label: "Status" },
  { kind: "message", label: "Message" },
];

function NotificationSoundSettings({
  soundsEnabled,
  volume,
  refreshAccount,
  showToast,
}: {
  soundsEnabled: boolean;
  volume: string;
  refreshAccount: () => Promise<unknown>;
  showToast: (message: string) => void;
}) {
  const [enabled, setEnabled] = useState(soundsEnabled);
  const [level, setLevel] = useState<"low" | "medium" | "high">(
    volume === "low" || volume === "high" ? volume : "medium",
  );
  const [saving, setSaving] = useState(false);

  async function savePreferences(next: { notificationSoundsEnabled?: boolean; notificationVolume?: string }) {
    setSaving(true);
    try {
      const res = await fetch("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        showToast("Could not save notification settings");
        return;
      }
      await refreshAccount();
    } catch {
      showToast("Could not save notification settings");
    } finally {
      setSaving(false);
    }
  }

  function toggleEnabled() {
    const next = !enabled;
    setEnabled(next);
    void savePreferences({ notificationSoundsEnabled: next });
  }

  function selectVolume(next: "low" | "medium" | "high") {
    setLevel(next);
    void savePreferences({ notificationVolume: next });
    playTestNotificationSound("message", next);
  }

  return (
    <div>
      <SectionTitle>Notification Sounds</SectionTitle>
      <div className="mt-4 flex items-start gap-3">
        <Bell size={18} strokeWidth={1.75} className="mt-0.5 text-white/45" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-white">Play a sound for new notifications</p>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={toggleEnabled}
              disabled={saving}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                enabled ? "bg-electric" : "bg-white/15"
              }`}
            >
              <span
                className={`inline-block h-[18px] w-[18px] transform rounded-full bg-white transition-transform ${
                  enabled ? "translate-x-[22px]" : "translate-x-1"
                }`}
              />
            </button>
          </div>
          <p className="mt-1 text-xs text-white/45">
            Statuses, opportunities, messages, and requests can play a short chime while
            you have Source Bridge open.
          </p>
        </div>
      </div>

      <div className="mt-5 border-t border-white/10 pt-5">
        <p className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-white/45">
          <Volume2 size={14} strokeWidth={1.75} />
          Volume
        </p>
        <div className="mt-3 flex gap-2">
          {VOLUME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => selectVolume(opt.value)}
              disabled={saving || !enabled}
              className={`h-9 flex-1 rounded-lg border text-xs font-medium uppercase tracking-[0.1em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                level === opt.value
                  ? "border-electric bg-electric/15 text-white"
                  : "border-white/15 text-white/60 hover:border-white/30 hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 border-t border-white/10 pt-5">
        <p className="text-xs uppercase tracking-[0.14em] text-white/45">Test sound</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {TEST_SOUNDS.map((s) => (
            <button
              key={s.kind}
              type="button"
              onClick={() => playTestNotificationSound(s.kind, level)}
              className="inline-flex h-9 items-center rounded-lg border border-white/15 px-4 text-xs font-medium uppercase tracking-[0.1em] text-white/70 transition-colors hover:border-electric/40 hover:text-white"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PasswordSection({
  hasPassword,
  emailVerified,
  refreshAccount,
  showToast,
}: {
  hasPassword: boolean;
  emailVerified: boolean;
  refreshAccount: () => Promise<unknown>;
  showToast: (message: string) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const strength = useMemo(
    () => (password ? passwordStrengthLevel(password) : null),
    [password],
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setDone(false);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, password, confirmPassword }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Could not update password");
        return;
      }
      setCurrentPassword("");
      setPassword("");
      setConfirmPassword("");
      setDone(true);
      await refreshAccount();
      showToast(hasPassword ? "Password changed" : "Password set");
    } catch {
      setError("Could not update password");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <SectionTitle>Password</SectionTitle>
      <div className="mt-4 flex items-start gap-3">
        <KeyRound size={18} strokeWidth={1.75} className="mt-0.5 text-white/45" />
        <div className="min-w-0">
          <p className="text-sm text-white">
            {hasPassword ? "Password set" : "No password set"}
          </p>
          <p className="mt-1 text-xs text-white/45">
            {hasPassword
              ? "Change your password below. You'll be signed out of all other sessions."
              : "Set a password to sign in with your email or username instead of a link."}
          </p>
        </div>
      </div>

      {!hasPassword && !emailVerified ? (
        <p className="mt-5 text-xs text-amber-300">
          Verify your email before setting a password.
        </p>
      ) : (
        <form className="mt-5 space-y-4 border-t border-white/10 pt-5" onSubmit={submit}>
          {hasPassword ? (
            <label className="block text-xs uppercase tracking-[0.14em] text-white/45">
              Current password
              <input
                required
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="input-navy mt-1.5 h-11 w-full rounded-lg px-4 text-sm"
                autoComplete="current-password"
              />
            </label>
          ) : null}
          <label className="block text-xs uppercase tracking-[0.14em] text-white/45">
            {hasPassword ? "New password" : "Password"}
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-navy mt-1.5 h-11 w-full rounded-lg px-4 text-sm"
              autoComplete="new-password"
              minLength={10}
            />
          </label>
          {strength ? (
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full transition-all ${STRENGTH_COPY[strength].className}`}
                  style={{ width: STRENGTH_WIDTH[strength] }}
                />
              </div>
              <span className="text-xs text-white/50">{STRENGTH_COPY[strength].label}</span>
            </div>
          ) : null}
          <label className="block text-xs uppercase tracking-[0.14em] text-white/45">
            Confirm password
            <input
              required
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="input-navy mt-1.5 h-11 w-full rounded-lg px-4 text-sm"
              autoComplete="new-password"
              minLength={10}
            />
          </label>
          <PrimaryButton type="submit" showArrow={false} disabled={submitting} className="rounded-lg">
            {submitting ? "Saving…" : hasPassword ? "Change password" : "Set password"}
          </PrimaryButton>
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
          {done && !error ? (
            <p className="text-sm text-electric">
              {hasPassword ? "Password changed." : "Password set."}
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}

function DeleteAccountSection({ hasPassword }: { hasPassword: boolean }) {
  const { refreshAccount } = useAppUi();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = hasPassword && confirmText === "DELETE" && password.length > 0 && !submitting;

  function closeModal() {
    if (submitting) return;
    setOpen(false);
    setConfirmText("");
    setPassword("");
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmText }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        accountClosed?: boolean;
      };
      // Only treat full success when the API confirms DB + file cleanup finished.
      if (!res.ok || !data.ok) {
        if (data.accountClosed) {
          // Session is already destroyed; leave settings without claiming success.
          await refreshAccount();
          window.location.assign("/");
          return;
        }
        setError(data.error || "Could not delete account");
        return;
      }
      await refreshAccount();
      // Full navigation clears any stale client caches.
      window.location.assign("/?deleted=1");
      return;
    } catch {
      setError("Could not delete account");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel-navy mt-6 rounded-xl border border-red-500/20 px-5 py-6 sm:px-6">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-red-300/80">
        Delete Account
      </h2>
      <div className="mt-4 flex items-start gap-3">
        <Trash2 size={18} strokeWidth={1.75} className="mt-0.5 text-red-400/80" />
        <div className="min-w-0">
          <p className="text-sm text-white">This action is permanent.</p>
          <p className="mt-1 text-xs leading-relaxed text-white/50">
            Deleting your account permanently removes your public profile,
            statuses, opportunities and uploaded verification documents. This
            action cannot be undone.
          </p>
        </div>
      </div>
      <div className="mt-5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-11 items-center rounded-lg border border-red-500/40 px-5 text-xs font-medium uppercase tracking-[0.14em] text-red-300 transition-colors hover:border-red-400 hover:text-red-200"
        >
          Delete my account
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            className="panel-navy w-full max-w-md rounded-xl border border-red-500/25 px-5 py-6 shadow-xl sm:px-6"
          >
            <h2 id="delete-account-title" className="font-display text-2xl text-white">
              Delete your account?
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/60">
              Deleting your account permanently removes your public profile,
              statuses, opportunities and uploaded verification documents. This
              action cannot be undone.
            </p>

            <form className="mt-5 space-y-4" onSubmit={submit}>
              {!hasPassword ? (
                <p className="text-sm text-amber-300">
                  Set a password in the Password section above before deleting
                  your account.
                </p>
              ) : (
                <>
                  <label className="block text-xs uppercase tracking-[0.14em] text-white/45">
                    Type DELETE to confirm
                    <input
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      className="input-navy mt-1.5 h-11 w-full rounded-lg px-4 text-sm"
                      autoComplete="off"
                      placeholder="DELETE"
                    />
                  </label>
                  <label className="block text-xs uppercase tracking-[0.14em] text-white/45">
                    Password
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="input-navy mt-1.5 h-11 w-full rounded-lg px-4 text-sm"
                      autoComplete="current-password"
                    />
                  </label>
                </>
              )}

              {error ? <p className="text-sm text-red-300">{error}</p> : null}

              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={submitting}
                  className="inline-flex h-11 items-center rounded-lg border border-white/20 px-4 text-xs font-medium uppercase tracking-[0.14em] text-white/70 hover:border-white/40 hover:text-white disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="inline-flex h-11 items-center rounded-lg bg-red-500 px-5 text-xs font-medium uppercase tracking-[0.14em] text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {submitting ? "Deleting…" : "Permanently delete my account"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
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

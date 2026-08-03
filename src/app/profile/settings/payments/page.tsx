"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useAppUi } from "@/components/providers/AppProviders";

type ConnectStatus = {
  configured: boolean;
  stripeMode: string;
  hasAccount: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  canReceiveProtectedPayments: boolean;
  country: string;
  disabledReason: string;
  lastSyncedAt: string | null;
};

type Flags = {
  PAYMENTS_ENABLED: boolean;
  PROTECTED_PAYMENTS_ENABLED: boolean;
  INSTANT_PAYMENTS_ENABLED: boolean;
  LIVE_PAYMENTS_ENABLED: boolean;
  stripeMode: string;
};

export default function PaymentsSettingsPage() {
  const router = useRouter();
  const { account, signedIn, authReady, showToast } = useAppUi();
  const [connect, setConnect] = useState<ConnectStatus | null>(null);
  const [flags, setFlags] = useState<Flags | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/payments/connect");
      const json = (await res.json()) as {
        ok?: boolean;
        connect?: ConnectStatus;
        flags?: Flags;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setConnect(json.connect || null);
      setFlags(json.flags || null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load payments");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (authReady && !signedIn) router.replace("/sign-in");
  }, [authReady, signedIn, router]);

  useEffect(() => {
    if (signedIn) void refresh();
  }, [signedIn, refresh]);

  async function runAction(action: "onboard" | "sync" | "login") {
    setBusy(true);
    try {
      const res = await fetch("/api/payments/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        url?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || "Action failed");
      if (json.url) {
        window.location.href = json.url;
        return;
      }
      await refresh();
      showToast("Payments settings updated");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

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
        <Link
          href="/profile/settings"
          className="text-xs text-white/45 hover:text-electric"
        >
          ← Account Settings
        </Link>
        <div className="mt-4 flex items-center gap-2">
          <ShieldCheck className="text-electric" size={22} />
          <h1 className="font-display text-4xl text-white">Payments & Payouts</h1>
        </div>
        <p className="mt-2 text-white/55">
          Receive Protected Payments through Source Bridge. Stripe processes
          cards; Source Bridge controls when funds are released to you.
        </p>

        {loading ? (
          <div className="mt-10 flex items-center gap-2 text-white/50">
            <Loader2 className="animate-spin" size={16} /> Loading…
          </div>
        ) : (
          <>
            <section className="panel-navy mt-8 rounded-xl px-5 py-6">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
                Status
              </p>
              <ul className="mt-4 space-y-2 text-sm text-white/75">
                <li>
                  Mode:{" "}
                  <span className="text-white">{flags?.stripeMode || "TEST"}</span>
                  {flags?.LIVE_PAYMENTS_ENABLED ? null : (
                    <span className="ml-2 text-xs text-white/40">
                      (live payments disabled)
                    </span>
                  )}
                </li>
                <li>
                  Payments enabled:{" "}
                  {flags?.PAYMENTS_ENABLED ? "Yes" : "No (feature flag)"}
                </li>
                <li>
                  Protected Payments:{" "}
                  {flags?.PROTECTED_PAYMENTS_ENABLED ? "On" : "Off"}
                </li>
                <li>
                  Connect linked: {connect?.hasAccount ? "Yes" : "Not yet"}
                </li>
                <li>
                  Charges enabled: {connect?.chargesEnabled ? "Yes" : "No"}
                </li>
                <li>
                  Payouts enabled: {connect?.payoutsEnabled ? "Yes" : "No"}
                </li>
                <li>
                  Ready for Protected Payments:{" "}
                  {connect?.canReceiveProtectedPayments ? "Yes" : "Not yet"}
                </li>
                {connect?.disabledReason ? (
                  <li className="text-amber-300">
                    Attention: {connect.disabledReason}
                  </li>
                ) : null}
              </ul>
            </section>

            <section className="panel-navy mt-6 rounded-xl px-5 py-6">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
                Stripe Connect
              </p>
              <p className="mt-2 text-sm text-white/55">
                Complete onboarding so Source Bridge can transfer your share
                after delivery and inspection (or promptly for Instant). Source
                Bridge never stores your bank or card details.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <PrimaryButton
                  showArrow={false}
                  className="rounded-lg"
                  disabled={busy || !connect?.configured}
                  onClick={() => void runAction("onboard")}
                >
                  {connect?.hasAccount ? "Continue onboarding" : "Set up payouts"}
                </PrimaryButton>
                {connect?.hasAccount ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void runAction("sync")}
                      className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/80 hover:border-electric/40 disabled:opacity-50"
                    >
                      Refresh status
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void runAction("login")}
                      className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/80 hover:border-electric/40 disabled:opacity-50"
                    >
                      Open Stripe dashboard
                    </button>
                  </>
                ) : null}
              </div>
              {!connect?.configured ? (
                <p className="mt-4 text-xs text-amber-300/90">
                  Stripe TEST keys are not configured in this environment, or
                  PAYMENTS_ENABLED is off. Onboarding will activate once ops
                  sets secrets and flags.
                </p>
              ) : null}
            </section>
          </>
        )}
      </Container>
    </div>
  );
}

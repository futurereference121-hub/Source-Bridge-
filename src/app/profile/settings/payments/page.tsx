"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useAppUi } from "@/components/providers/AppProviders";
import {
  deriveConnectPayoutUi,
  shouldSyncOnConnectReturn,
} from "@/lib/payments/stripe/connectPayoutUi";
import type { ConnectStatus } from "@/lib/payments/stripe/connect";

function PaymentsSettingsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { account, signedIn, authReady, showToast } = useAppUi();
  const [connect, setConnect] = useState<ConnectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const returnSynced = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/payments/connect");
      const json = (await res.json()) as {
        ok?: boolean;
        connect?: ConnectStatus;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setConnect(json.connect || null);
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

  useEffect(() => {
    if (!signedIn || loading) return;
    const connectParam = searchParams.get("connect");
    if (!shouldSyncOnConnectReturn(connectParam, returnSynced.current)) return;
    returnSynced.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/payments/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sync" }),
        });
        if (res.ok) {
          await refresh();
          router.replace("/profile/settings/payments", { scroll: false });
        }
      } catch {
        // Best-effort; user can still click Refresh status.
      }
    })();
  }, [signedIn, loading, searchParams, refresh, router]);

  if (!authReady || !account) {
    return (
      <div className="bg-app-navy min-h-[100svh] pt-28 pb-20 text-white">
        <Container className="max-w-lg">
          <p className="text-white/50">Loading…</p>
        </Container>
      </div>
    );
  }

  const ui = deriveConnectPayoutUi(connect);
  const disabledReason = connect?.disabledReason?.trim() || "";

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
          <section className="panel-navy mt-8 rounded-xl px-5 py-6">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
              {ui.headline}
              {ui.statusLine ? (
                <span className="text-white/70"> / {ui.statusLine}</span>
              ) : null}
            </p>
            <p className="mt-3 text-sm text-white/75">{ui.helpCopy}</p>
            {disabledReason ? (
              <p className="mt-2 text-sm text-amber-300">Attention: {disabledReason}</p>
            ) : null}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {ui.showSetUpPayouts ? (
                <PrimaryButton
                  showArrow={false}
                  className="rounded-lg"
                  disabled={busy || !ui.actionsEnabled}
                  onClick={() => void runAction("onboard")}
                >
                  Set up payouts
                </PrimaryButton>
              ) : null}
              {ui.showContinueOnboarding ? (
                <PrimaryButton
                  showArrow={false}
                  className="rounded-lg"
                  disabled={busy || !ui.actionsEnabled}
                  onClick={() => void runAction("onboard")}
                >
                  Continue onboarding
                </PrimaryButton>
              ) : null}
              {ui.showRefreshStatus ? (
                <button
                  type="button"
                  disabled={busy || !ui.actionsEnabled}
                  onClick={() => void runAction("sync")}
                  className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/80 hover:border-electric/40 disabled:opacity-50"
                >
                  Refresh status
                </button>
              ) : null}
              {ui.showOpenStripeDashboard ? (
                <button
                  type="button"
                  disabled={busy || !ui.actionsEnabled}
                  onClick={() => void runAction("login")}
                  className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/80 hover:border-electric/40 disabled:opacity-50"
                >
                  Open Stripe dashboard
                </button>
              ) : null}
            </div>
            {ui.footnote ? (
              <p className="mt-4 text-xs text-white/45">{ui.footnote}</p>
            ) : null}
          </section>
        )}
      </Container>
    </div>
  );
}

export default function PaymentsSettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="bg-app-navy min-h-[100svh] pt-28 pb-20 text-white">
          <Container className="max-w-lg">
            <p className="text-white/50">Loading…</p>
          </Container>
        </div>
      }
    >
      <PaymentsSettingsInner />
    </Suspense>
  );
}

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
import {
  deriveGpPayoutUi,
  shouldSyncOnGpReturn,
} from "@/lib/payments/payout-rail/gpPayoutUi";
import type { GlobalPayoutStatus } from "@/lib/payments/payout-rail/recipient";

type RailSummary = {
  rail: string;
  reason: string;
  payoutReady: boolean;
  country: string;
};

type CountryOption = { code: string; name: string };

type RouteConfirmation = {
  countryCode: string;
  countryName: string;
  rail: string;
  reason: string;
  railLabel: string;
  explanation: string;
  currency: string | null;
  payoutMethod: string | null;
  continueLabel: "Continue to Stripe" | "Continue setup";
  canProceed: boolean;
};

/** select = country picker; confirm = route review; main = post-setup / ordinary CTAs */
type SetupStep = "select" | "confirm" | "main";

function PaymentsSettingsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { account, signedIn, authReady, showToast } = useAppUi();
  const [connect, setConnect] = useState<ConnectStatus | null>(null);
  const [gp, setGp] = useState<GlobalPayoutStatus | null>(null);
  const [rail, setRail] = useState<RailSummary | null>(null);
  const [needsPayoutCountry, setNeedsPayoutCountry] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState("");
  const [countryOptions, setCountryOptions] = useState<CountryOption[]>([]);
  const [countryLocked, setCountryLocked] = useState(false);
  const [confirmation, setConfirmation] = useState<RouteConfirmation | null>(
    null,
  );
  const [setupStep, setSetupStep] = useState<SetupStep>("main");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const returnSynced = useRef(false);
  const gpReturnSynced = useRef(false);

  const returnToCountrySelector = useCallback(() => {
    // Until Connect / GP recipient exists, Back must reopen the selector
    // with the prior country still highlighted — never the generic Continue panel.
    setSetupStep("select");
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [connectRes, gpRes, countryRes] = await Promise.all([
        fetch("/api/payments/connect"),
        fetch("/api/payments/global-payouts"),
        fetch("/api/payments/payout-country"),
      ]);
      const connectJson = (await connectRes.json()) as {
        ok?: boolean;
        connect?: ConnectStatus;
        error?: string;
        needsPayoutCountry?: boolean;
        country?: string;
      };
      if (!connectRes.ok) throw new Error(connectJson.error || "Failed to load");
      setConnect(connectJson.connect || null);

      let nextNeedsCountry = Boolean(connectJson.needsPayoutCountry);
      if (connectJson.country) setSelectedCountry(connectJson.country);

      if (gpRes.ok) {
        const gpJson = (await gpRes.json()) as {
          ok?: boolean;
          globalPayouts?: GlobalPayoutStatus;
          rail?: RailSummary;
          needsPayoutCountry?: boolean;
          country?: string;
        };
        setGp(gpJson.globalPayouts || null);
        setRail(gpJson.rail || null);
        nextNeedsCountry = Boolean(gpJson.needsPayoutCountry);
        if (gpJson.country) setSelectedCountry(gpJson.country);
      } else {
        setGp(null);
        setRail(null);
      }
      setNeedsPayoutCountry(nextNeedsCountry);

      let nextLocked = false;
      if (countryRes.ok) {
        const countryJson = (await countryRes.json()) as {
          countries?: CountryOption[];
          country?: string;
          needsPayoutCountry?: boolean;
          countryLocked?: boolean;
          rail?: RailSummary;
          confirmation?: RouteConfirmation | null;
        };
        if (Array.isArray(countryJson.countries)) {
          setCountryOptions(countryJson.countries);
        }
        nextLocked = Boolean(countryJson.countryLocked);
        setCountryLocked(nextLocked);
        if (countryJson.country) setSelectedCountry(countryJson.country);
        if (typeof countryJson.needsPayoutCountry === "boolean") {
          nextNeedsCountry = countryJson.needsPayoutCountry;
          setNeedsPayoutCountry(nextNeedsCountry);
        }
        if (countryJson.rail) setRail(countryJson.rail);
        if (countryJson.confirmation) {
          setConfirmation(countryJson.confirmation);
        }
      }
      // Never auto-open confirmation or redirect to Stripe on load.
      // Missing country → selector; otherwise ordinary main CTAs.
      setSetupStep(nextNeedsCountry && !nextLocked ? "select" : "main");
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

  async function savePayoutCountry() {
    setBusy(true);
    try {
      const res = await fetch("/api/payments/payout-country", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country: selectedCountry }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        country?: string;
        needsPayoutCountry?: boolean;
        countryLocked?: boolean;
        rail?: RailSummary;
        confirmation?: RouteConfirmation | null;
        stripeAccountCreated?: boolean;
        recipientCreated?: boolean;
      };
      if (!res.ok) throw new Error(json.error || "Could not save country");
      // Country save must never create Stripe objects.
      if (json.stripeAccountCreated || json.recipientCreated) {
        throw new Error("Unexpected payout setup side effect");
      }
      setNeedsPayoutCountry(Boolean(json.needsPayoutCountry));
      setCountryLocked(Boolean(json.countryLocked));
      if (json.country) setSelectedCountry(json.country);
      if (json.rail) setRail(json.rail);
      if (json.confirmation?.canProceed) {
        setConfirmation(json.confirmation);
        setSetupStep("confirm");
        showToast("Payout country saved");
      } else if (json.confirmation) {
        setConfirmation(json.confirmation);
        setSetupStep("select");
        showToast(
          json.confirmation.explanation ||
            "Payouts are not yet available in your location.",
        );
      } else {
        showToast("Payout country saved");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not save country");
    } finally {
      setBusy(false);
    }
  }

  async function openRouteConfirmation() {
    setBusy(true);
    try {
      const qs = selectedCountry
        ? `?country=${encodeURIComponent(selectedCountry)}`
        : "";
      const res = await fetch(`/api/payments/payout-country${qs}`);
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        confirmation?: RouteConfirmation | null;
        rail?: RailSummary;
        country?: string;
        countryLocked?: boolean;
      };
      if (!res.ok) throw new Error(json.error || "Could not load payout route");
      if (typeof json.countryLocked === "boolean") {
        setCountryLocked(json.countryLocked);
      }
      if (!json.confirmation?.canProceed) {
        throw new Error(
          json.confirmation?.explanation ||
            "Payouts are not yet available in your location.",
        );
      }
      setConfirmation(json.confirmation);
      if (json.rail) setRail(json.rail);
      if (json.country) setSelectedCountry(json.country);
      setSetupStep("confirm");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Could not load payout route",
      );
    } finally {
      setBusy(false);
    }
  }

  async function continueToStripe() {
    if (!confirmation?.canProceed) return;
    setBusy(true);
    try {
      const railName = confirmation.rail;
      const endpoint =
        railName === "STRIPE_GLOBAL_PAYOUTS"
          ? "/api/payments/global-payouts"
          : "/api/payments/connect";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "onboard",
          country: confirmation.countryCode,
          expectedRail: confirmation.rail,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        url?: string;
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        if (json.code === "PAYOUT_COUNTRY_REQUIRED") {
          setNeedsPayoutCountry(true);
          setSetupStep("select");
        }
        throw new Error(json.error || "Action failed");
      }
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

  async function runConnectAction(action: "sync" | "login") {
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

  async function runGpSync() {
    setBusy(true);
    try {
      const res = await fetch("/api/payments/global-payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error || "Action failed");
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

  useEffect(() => {
    if (!signedIn || loading) return;
    const gpParam = searchParams.get("gp");
    if (!shouldSyncOnGpReturn(gpParam, gpReturnSynced.current)) return;
    gpReturnSynced.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/payments/global-payouts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sync" }),
        });
        if (res.ok) {
          await refresh();
          router.replace("/profile/settings/payments", { scroll: false });
        }
      } catch {
        // Best-effort
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
  const gpUi = deriveGpPayoutUi(gp);
  const disabledReason = connect?.disabledReason?.trim() || "";
  const showCountrySelector = setupStep === "select";
  // Server rail is authoritative — never show GP actions for Connect-routed users.
  const showGpPanel =
    !showCountrySelector &&
    setupStep === "main" &&
    Boolean(gp?.enabled) &&
    rail?.rail === "STRIPE_GLOBAL_PAYOUTS" &&
    !needsPayoutCountry;
  const showUnsupported =
    !showCountrySelector &&
    setupStep === "main" &&
    !needsPayoutCountry &&
    rail?.rail === "UNSUPPORTED" &&
    !connect?.hasAccount &&
    !gp?.payoutReady;
  const showConnectPanel =
    !showCountrySelector &&
    setupStep === "main" &&
    !needsPayoutCountry &&
    !showUnsupported &&
    (rail?.rail === "STRIPE_CONNECT" ||
      rail?.rail == null ||
      Boolean(connect?.hasAccount));

  const showPrimarySetup =
    (showConnectPanel && (ui.showSetUpPayouts || ui.showContinueOnboarding)) ||
    (showGpPanel && (gpUi.showSetUpPayouts || gpUi.showContinue));
  const primarySetupLabel =
    (showConnectPanel && ui.showContinueOnboarding) ||
    (showGpPanel && gpUi.showContinue)
      ? "Continue setup"
      : "Set up payouts";

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
            {showCountrySelector ? (
              <section className="panel-navy mt-8 rounded-xl px-5 py-6">
                <h2 className="text-xl font-semibold text-white">
                  Where will you receive payouts?
                </h2>
                <p className="mt-3 text-sm text-white/75">
                  We use this to provide the payout setup available in your
                  country.
                </p>
                <label className="mt-5 block text-xs uppercase tracking-[0.14em] text-white/45">
                  Country
                  <select
                    value={selectedCountry}
                    onChange={(e) => setSelectedCountry(e.target.value)}
                    className="input-navy mt-1.5 h-11 w-full rounded-lg px-4 text-sm"
                    disabled={busy || countryLocked}
                  >
                    <option value="">Select a country</option>
                    {countryOptions.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                {countryLocked ? (
                  <p className="mt-3 text-sm text-amber-300">
                    Your payout country cannot be changed after payout setup has
                    started. Contact support for help.
                  </p>
                ) : null}
                <div className="mt-5">
                  <PrimaryButton
                    showArrow={false}
                    className="rounded-lg"
                    disabled={busy || !selectedCountry || countryLocked}
                    onClick={() => void savePayoutCountry()}
                  >
                    Continue
                  </PrimaryButton>
                </div>
              </section>
            ) : null}

            {setupStep === "confirm" && confirmation ? (
              <section className="panel-navy mt-8 rounded-xl px-5 py-6">
                <h2 className="text-xl font-semibold text-white">
                  Confirm payout setup
                </h2>
                <p className="mt-3 text-sm text-white/75">
                  Review where you will receive payouts before continuing to
                  Stripe.
                </p>
                <dl className="mt-5 space-y-3 text-sm">
                  <div>
                    <dt className="text-xs uppercase tracking-[0.14em] text-white/45">
                      Selected country
                    </dt>
                    <dd className="mt-1 text-white">
                      {confirmation.countryName} ({confirmation.countryCode})
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-[0.14em] text-white/45">
                      Payout route
                    </dt>
                    <dd className="mt-1 text-white">
                      Payout route: {confirmation.railLabel}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-[0.14em] text-white/45">
                      Why this route
                    </dt>
                    <dd className="mt-1 text-white/80">
                      {confirmation.explanation}
                    </dd>
                  </div>
                  {confirmation.currency ? (
                    <div>
                      <dt className="text-xs uppercase tracking-[0.14em] text-white/45">
                        Currency
                      </dt>
                      <dd className="mt-1 text-white">{confirmation.currency}</dd>
                    </div>
                  ) : null}
                  {confirmation.payoutMethod ? (
                    <div>
                      <dt className="text-xs uppercase tracking-[0.14em] text-white/45">
                        Payout method
                      </dt>
                      <dd className="mt-1 text-white">
                        {confirmation.payoutMethod}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                {countryLocked ? (
                  <p className="mt-4 text-sm text-amber-300">
                    Your payout country cannot be changed after payout setup has
                    started. Contact support for help.
                  </p>
                ) : null}
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <PrimaryButton
                    showArrow={false}
                    className="rounded-lg"
                    disabled={busy || !confirmation.canProceed}
                    onClick={() => void continueToStripe()}
                  >
                    {confirmation.continueLabel}
                  </PrimaryButton>
                  {!countryLocked ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={returnToCountrySelector}
                        className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/80 hover:border-electric/40 disabled:opacity-50"
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={returnToCountrySelector}
                        className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/80 hover:border-electric/40 disabled:opacity-50"
                      >
                        Change country
                      </button>
                    </>
                  ) : null}
                </div>
              </section>
            ) : null}

            {setupStep === "main" && showUnsupported ? (
              <section className="panel-navy mt-8 rounded-xl px-5 py-6">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
                  Payouts
                </p>
                <p className="mt-3 text-sm text-white/75">
                  Payouts are not yet available in your location.
                </p>
              </section>
            ) : null}

            {setupStep === "main" && showConnectPanel ? (
              <section className="panel-navy mt-8 rounded-xl px-5 py-6">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
                  {ui.headline}
                  {ui.statusLine ? (
                    <span className="text-white/70"> / {ui.statusLine}</span>
                  ) : null}
                </p>
                <p className="mt-3 text-sm text-white/75">{ui.helpCopy}</p>
                {disabledReason ? (
                  <p className="mt-2 text-sm text-amber-300">
                    Attention: {disabledReason}
                  </p>
                ) : null}
                {countryLocked ? (
                  <p className="mt-2 text-sm text-amber-300">
                    Your payout country cannot be changed after payout setup has
                    started. Contact support for help.
                  </p>
                ) : null}
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  {showPrimarySetup && showConnectPanel ? (
                    <PrimaryButton
                      showArrow={false}
                      className="rounded-lg"
                      disabled={busy || !ui.actionsEnabled}
                      onClick={() => void openRouteConfirmation()}
                    >
                      {primarySetupLabel}
                    </PrimaryButton>
                  ) : null}
                  {!countryLocked ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={returnToCountrySelector}
                      className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/80 hover:border-electric/40 disabled:opacity-50"
                    >
                      Change country
                    </button>
                  ) : null}
                  {ui.showRefreshStatus ? (
                    <button
                      type="button"
                      disabled={busy || !ui.actionsEnabled}
                      onClick={() => void runConnectAction("sync")}
                      className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/80 hover:border-electric/40 disabled:opacity-50"
                    >
                      Refresh status
                    </button>
                  ) : null}
                  {ui.showOpenStripeDashboard ? (
                    <button
                      type="button"
                      disabled={busy || !ui.actionsEnabled}
                      onClick={() => void runConnectAction("login")}
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
            ) : null}

            {setupStep === "main" && showGpPanel && !showUnsupported ? (
              <section className="panel-navy mt-6 rounded-xl px-5 py-6">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
                  {gpUi.headline}
                  {gpUi.statusLine ? (
                    <span className="text-white/70"> / {gpUi.statusLine}</span>
                  ) : null}
                </p>
                <p className="mt-3 text-sm text-white/75">{gpUi.helpCopy}</p>
                {countryLocked ? (
                  <p className="mt-2 text-sm text-amber-300">
                    Your payout country cannot be changed after payout setup has
                    started. Contact support for help.
                  </p>
                ) : null}
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  {showPrimarySetup && showGpPanel ? (
                    <PrimaryButton
                      showArrow={false}
                      className="rounded-lg"
                      disabled={busy || !gpUi.actionsEnabled}
                      onClick={() => void openRouteConfirmation()}
                    >
                      {primarySetupLabel}
                    </PrimaryButton>
                  ) : null}
                  {!countryLocked ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={returnToCountrySelector}
                      className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/80 hover:border-electric/40 disabled:opacity-50"
                    >
                      Change country
                    </button>
                  ) : null}
                  {gpUi.showRefreshStatus ? (
                    <button
                      type="button"
                      disabled={busy || !gpUi.actionsEnabled}
                      onClick={() => void runGpSync()}
                      className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/80 hover:border-electric/40 disabled:opacity-50"
                    >
                      Refresh status
                    </button>
                  ) : null}
                </div>
              </section>
            ) : null}
          </>
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

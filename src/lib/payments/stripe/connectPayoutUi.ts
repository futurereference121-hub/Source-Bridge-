import type { ConnectStatus } from "@/lib/payments/stripe/connect";

export type ConnectPayoutUiState =
  | "not_started"
  | "onboarding_incomplete"
  | "pending_review"
  | "ready";

export type ConnectPayoutUiInput = Pick<
  ConnectStatus,
  | "hasAccount"
  | "detailsSubmitted"
  | "chargesEnabled"
  | "payoutsEnabled"
  | "requirementsDueCount"
  | "canReceiveProtectedPayments"
  | "onboardingReady"
  | "stripeTestConfigured"
>;

export type ConnectPayoutUiModel = {
  state: ConnectPayoutUiState;
  headline: string;
  statusLine: string | null;
  helpCopy: string;
  footnote: string | null;
  showSetUpPayouts: boolean;
  showContinueOnboarding: boolean;
  showRefreshStatus: boolean;
  showOpenStripeDashboard: boolean;
  actionsEnabled: boolean;
};

export function isConnectPayoutReady(
  connect: ConnectPayoutUiInput,
): boolean {
  return (
    connect.hasAccount &&
    connect.detailsSubmitted &&
    connect.chargesEnabled &&
    connect.payoutsEnabled &&
    connect.requirementsDueCount === 0 &&
    connect.canReceiveProtectedPayments
  );
}

function onboardingUnavailableCopy(connect: ConnectPayoutUiInput | null): string {
  if (connect && !connect.onboardingReady) {
    return "Payout setup is not currently available.";
  }
  if (connect && !connect.stripeTestConfigured && !connect.onboardingReady) {
    return "Stripe configuration is unavailable.";
  }
  return "Payout setup is not currently available.";
}

export function deriveConnectPayoutUi(
  connect: ConnectPayoutUiInput | null,
): ConnectPayoutUiModel {
  const actionsEnabled = Boolean(connect?.onboardingReady);

  if (!connect?.hasAccount) {
    return {
      state: "not_started",
      headline: "Stripe Payouts",
      statusLine: null,
      helpCopy: actionsEnabled
        ? "Set up payouts securely through Stripe."
        : onboardingUnavailableCopy(connect),
      footnote: null,
      showSetUpPayouts: actionsEnabled,
      showContinueOnboarding: false,
      showRefreshStatus: false,
      showOpenStripeDashboard: false,
      actionsEnabled,
    };
  }

  if (isConnectPayoutReady(connect)) {
    return {
      state: "ready",
      headline: "Stripe Payouts",
      statusLine: "✓ Payout account connected",
      helpCopy:
        "Your Stripe account is ready to receive Source Bridge payouts.",
      footnote: "Managed securely through Stripe.",
      showSetUpPayouts: false,
      showContinueOnboarding: false,
      showRefreshStatus: false,
      showOpenStripeDashboard: true,
      actionsEnabled,
    };
  }

  if (connect.detailsSubmitted && connect.requirementsDueCount === 0) {
    return {
      state: "pending_review",
      headline: "Stripe Payouts",
      statusLine: "Verification pending",
      helpCopy: "Stripe is reviewing your payout account.",
      footnote: null,
      showSetUpPayouts: false,
      showContinueOnboarding: false,
      showRefreshStatus: true,
      showOpenStripeDashboard: true,
      actionsEnabled,
    };
  }

  return {
    state: "onboarding_incomplete",
    headline: "Stripe Payouts",
    statusLine: "Onboarding incomplete",
    helpCopy: "Complete your Stripe setup before you can receive payouts.",
    footnote: null,
    showSetUpPayouts: false,
    showContinueOnboarding: actionsEnabled,
    showRefreshStatus: true,
    showOpenStripeDashboard: true,
    actionsEnabled,
  };
}

/** One-shot sync when returning from Stripe Account Link (no polling). */
export function shouldSyncOnConnectReturn(
  connectParam: string | null,
  alreadySynced: boolean,
): boolean {
  if (alreadySynced) return false;
  return connectParam === "return" || connectParam === "refresh";
}

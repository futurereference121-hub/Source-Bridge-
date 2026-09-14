/**
 * Second-rail payout UI copy — provider-neutral product language.
 * Prefer "Set up payouts" / "Payout ready" over Stripe product names.
 */

export type GpPayoutUiState =
  | "unavailable"
  | "not_started"
  | "onboarding_incomplete"
  | "needs_attention"
  | "ready";

export type GpPayoutUiInput = {
  enabled: boolean;
  configured: boolean;
  hasRecipient: boolean;
  status: string;
  payoutReady: boolean;
  payoutMethodReady: boolean;
  requirementsDueCount: number;
  disabledReason: string;
};

export type GpPayoutUiModel = {
  state: GpPayoutUiState;
  headline: string;
  statusLine: string | null;
  helpCopy: string;
  showSetUpPayouts: boolean;
  showContinue: boolean;
  showRefreshStatus: boolean;
  actionsEnabled: boolean;
};

export function deriveGpPayoutUi(input: GpPayoutUiInput | null): GpPayoutUiModel {
  if (!input?.enabled) {
    return {
      state: "unavailable",
      headline: "Payouts",
      statusLine: null,
      helpCopy: "Payout setup is not currently available.",
      showSetUpPayouts: false,
      showContinue: false,
      showRefreshStatus: false,
      actionsEnabled: false,
    };
  }

  if (!input.configured) {
    return {
      state: "unavailable",
      headline: "Payouts",
      statusLine: null,
      helpCopy: "Payout setup is not currently available.",
      showSetUpPayouts: false,
      showContinue: false,
      showRefreshStatus: false,
      actionsEnabled: false,
    };
  }

  if (input.payoutReady) {
    return {
      state: "ready",
      headline: "Payouts",
      statusLine: "Payout ready",
      helpCopy: "Your payout account is ready to receive Source Bridge releases.",
      showSetUpPayouts: false,
      showContinue: false,
      showRefreshStatus: false,
      actionsEnabled: true,
    };
  }

  if (!input.hasRecipient) {
    return {
      state: "not_started",
      headline: "Payouts",
      statusLine: null,
      helpCopy: "Set up payouts securely to receive Protected Payment releases.",
      showSetUpPayouts: true,
      showContinue: false,
      showRefreshStatus: false,
      actionsEnabled: true,
    };
  }

  if (
    input.requirementsDueCount > 0 ||
    input.status === "ACTION_REQUIRED" ||
    input.disabledReason
  ) {
    return {
      state: "needs_attention",
      headline: "Payouts",
      statusLine: "Needs attention",
      helpCopy:
        input.disabledReason ||
        "Complete the remaining payout steps to become payout ready.",
      showSetUpPayouts: false,
      showContinue: true,
      showRefreshStatus: true,
      actionsEnabled: true,
    };
  }

  return {
    state: "onboarding_incomplete",
    headline: "Payouts",
    statusLine: "Continue setup",
    helpCopy: "Continue payout setup to receive Protected Payment releases.",
    showSetUpPayouts: false,
    showContinue: true,
    showRefreshStatus: true,
    actionsEnabled: true,
  };
}

export function shouldSyncOnGpReturn(
  gpParam: string | null,
  alreadySynced: boolean,
): boolean {
  if (alreadySynced) return false;
  return gpParam === "return" || gpParam === "refresh";
}

import { prisma } from "@/lib/db";
import {
  DASHBOARD_BANK_CONFIRMATION_EVIDENCE,
  assessTestPlatformAccount,
  dashboardBankConfirmationMatches,
} from "@/lib/payments/payout-rail/platform-balance";
import { idHash8 } from "@/lib/payments/payout-rail/proceeds-preflight-shape";
import type { StripeMode } from "@/lib/payments/flags";

/**
 * Account.livemode is not a reliable TEST contract for API 2025-08-27.basil.
 * An omitted field is not LIVE. An explicit true is LIVE and must be rejected.
 */
export function retrievedAccountLivemode(account: object): boolean | null {
  const value = (account as { livemode?: unknown }).livemode;
  return value === true ? true : value === false ? false : null;
}

export function stripeAccountIdentity(accountId: string): { suffix: string; hash8: string } {
  const id = accountId.trim();
  return { suffix: id.slice(-4), hash8: id ? idHash8(id) : "" };
}

function missingTable(err: unknown): boolean {
  const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
  return code === "P2021";
}

/** Look up a Dashboard confirmation for this retrieved account. Other accounts do not match. */
export async function dashboardConfirmationForAccount(opts: {
  stripeMode: StripeMode;
  currency: string;
  accountId: string;
  /** Mode-bearing evidence such as Balance.livemode. Account.livemode is not required. */
  modeEvidenceLivemode: boolean | null;
  accountLivemode?: boolean | null;
}): Promise<"recorded" | "absent"> {
  const currency = opts.currency.trim().toUpperCase();
  const assessed = assessTestPlatformAccount({
    stripeMode: opts.stripeMode,
    accountId: opts.accountId,
    accountLivemode: opts.accountLivemode ?? null,
    modeEvidenceLivemode: opts.modeEvidenceLivemode,
  });
  if (!assessed.ok || currency !== "GBP") return "absent";
  try {
    const row = await prisma.platformBankDashboardConfirmation.findUnique({
      where: {
        stripeMode_currency_stripeAccountHash: {
          stripeMode: "TEST",
          currency: "GBP",
          stripeAccountHash: assessed.hash8,
        },
      },
    });
    if (!row) return "absent";
    return dashboardBankConfirmationMatches({
      stripeMode: row.stripeMode,
      currency: row.currency,
      accountSuffix: row.accountSuffix,
      livemode: false,
      evidence: row.evidence,
      recordedAccountHash: row.stripeAccountHash,
      currentAccountHash: assessed.hash8,
    })
      ? "recorded"
      : "absent";
  } catch (err) {
    if (missingTable(err)) return "absent";
    throw err;
  }
}

export { DASHBOARD_BANK_CONFIRMATION_EVIDENCE, assessTestPlatformAccount };

import { prisma } from "@/lib/db";
import { idHash8 } from "@/lib/payments/payout-rail/proceeds-preflight-shape";
import {
  DASHBOARD_BANK_CONFIRMATION_ACCOUNT_SUFFIX,
  DASHBOARD_BANK_CONFIRMATION_EVIDENCE,
  dashboardBankConfirmationMatches,
} from "@/lib/payments/payout-rail/platform-balance";
import type { StripeMode } from "@/lib/payments/flags";

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
  livemode: boolean;
}): Promise<"recorded" | "absent"> {
  const currency = opts.currency.trim().toUpperCase();
  const identity = stripeAccountIdentity(opts.accountId);
  if (opts.stripeMode !== "TEST" || currency !== "GBP" || opts.livemode !== false) return "absent";
  if (identity.suffix !== DASHBOARD_BANK_CONFIRMATION_ACCOUNT_SUFFIX || !identity.hash8) return "absent";
  try {
    const row = await prisma.platformBankDashboardConfirmation.findUnique({
      where: {
        stripeMode_currency_stripeAccountHash: {
          stripeMode: "TEST",
          currency: "GBP",
          stripeAccountHash: identity.hash8,
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
      currentAccountHash: identity.hash8,
    })
      ? "recorded"
      : "absent";
  } catch (err) {
    if (missingTable(err)) return "absent";
    throw err;
  }
}

export { DASHBOARD_BANK_CONFIRMATION_EVIDENCE };

/**
 * Admin-only read of the approved TEST purchase and the TEST platform account.
 * GET reads only. No quote, funding payout, top-up, refund, transfer, or
 * payout-schedule change.
 */

import { prisma } from "@/lib/db";
import { readFinancialAccountBalance } from "@/lib/payments/payout-rail/fa-funding";
import {
  safeChargeFacts,
  selectApprovedTestPurchase,
  UNVERIFIED_WRITE_PERMISSIONS,
  webhookEventCoverage,
  type ApprovedPurchaseRow,
  type ChargeReadFacts,
} from "@/lib/payments/payout-rail/proceeds-preflight-shape";
import {
  assessChargePayoutMembership,
  balanceTransactionObjectHasPayoutProperty,
} from "@/lib/payments/payout-rail/proceeds-funding";
import { getStripe } from "@/lib/payments/stripe/client";
import { PLATFORM_WEBHOOK_EVENTS } from "@/lib/payments/stripe/webhooks";

type ReadName = "charge" | "financial_account_balance" | "payout_schedule" | "webhook_endpoints";

type ReadOutcome =
  | { name: ReadName; status: "verified" }
  | { name: ReadName; status: "permission_denied" | "failed" | "mode_mismatch" | "unread" };

export type ProceedsPreflightReport = {
  ok: boolean;
  stripeMode: "TEST";
  purchaseHash: "597151ee" | null;
  stripeCalled: boolean;
  charge: ChargeReadFacts | null;
  balanceTransaction: {
    apiVersion: string | null;
    object: string | null;
    keys: string[];
    payoutPropertyPresent: boolean;
    type: string | null;
    status: string | null;
  } | null;
  automaticPayoutMembership: {
    filterAutomaticOnly: true;
    automaticPayoutsListed: number;
    unreadAutomaticPayouts: number;
    chargeBtInNonOwnAutomaticPayout: boolean | null;
    membershipState: "paid_out" | "unread" | "clear" | null;
  } | null;
  financialAccountAvailableGbpMinor: number | null;
  payoutScheduleInterval: string | null;
  webhooks: { covered: string[]; missing: string[] } | null;
  permissions: {
    verifiedReads: ReadName[];
    unverifiedReads: Array<{ name: ReadName; status: "permission_denied" | "failed" | "mode_mismatch" | "unread" }>;
    unverifiedWrites: readonly string[];
  };
};

function permissionFailure(err: unknown): "permission_denied" | "failed" {
  const status =
    err && typeof err === "object" && "statusCode" in err ? Number(err.statusCode) : 0;
  if (status === 401 || status === 403) return "permission_denied";
  return "failed";
}

function reportFrom(opts: {
  purchaseHash: "597151ee" | null;
  stripeCalled: boolean;
  charge: ChargeReadFacts | null;
  balanceTransaction?: ProceedsPreflightReport["balanceTransaction"];
  automaticPayoutMembership?: ProceedsPreflightReport["automaticPayoutMembership"];
  financialAccountAvailableGbpMinor: number | null;
  payoutScheduleInterval: string | null;
  webhooks: { covered: string[]; missing: string[] } | null;
  reads: ReadOutcome[];
}): ProceedsPreflightReport {
  const verifiedReads = opts.reads.filter((row) => row.status === "verified").map((row) => row.name);
  const unverifiedReads = opts.reads
    .filter((row) => row.status !== "verified")
    .map((row) => ({
      name: row.name,
      status: row.status as "permission_denied" | "failed" | "mode_mismatch" | "unread",
    }));
  return {
    ok: opts.purchaseHash !== null,
    stripeMode: "TEST",
    purchaseHash: opts.purchaseHash,
    stripeCalled: opts.stripeCalled,
    charge: opts.charge,
    balanceTransaction: opts.balanceTransaction ?? null,
    automaticPayoutMembership: opts.automaticPayoutMembership ?? null,
    financialAccountAvailableGbpMinor: opts.financialAccountAvailableGbpMinor,
    payoutScheduleInterval: opts.payoutScheduleInterval,
    webhooks: opts.webhooks,
    permissions: {
      verifiedReads,
      unverifiedReads,
      unverifiedWrites: UNVERIFIED_WRITE_PERMISSIONS,
    },
  };
}

export async function runApprovedTestPreflight(): Promise<ProceedsPreflightReport> {
  const rows = await prisma.protectedTransaction.findMany({
    where: {
      stripeMode: "TEST",
      payoutRail: "STRIPE_GLOBAL_PAYOUTS",
      currency: "GBP",
      totalChargeMinor: 4025,
    },
    select: {
      id: true,
      buyerId: true,
      sellerId: true,
      stripeChargeId: true,
      stripeMode: true,
      payoutRail: true,
      currency: true,
      totalChargeMinor: true,
      status: true,
    },
  });
  const purchase = selectApprovedTestPurchase(rows as ApprovedPurchaseRow[]);
  if (!purchase?.stripeChargeId) {
    return reportFrom({
      purchaseHash: null,
      stripeCalled: false,
      charge: null,
      financialAccountAvailableGbpMinor: null,
      payoutScheduleInterval: null,
      webhooks: null,
      reads: [
        { name: "charge", status: "unread" },
        { name: "financial_account_balance", status: "unread" },
        { name: "payout_schedule", status: "unread" },
        { name: "webhook_endpoints", status: "unread" },
      ],
    });
  }

  const stripe = getStripe("TEST");
  let stripeCalled = false;
  let charge: ChargeReadFacts | null = null;
  let balanceTransaction: ProceedsPreflightReport["balanceTransaction"] = null;
  let automaticPayoutMembership: ProceedsPreflightReport["automaticPayoutMembership"] = null;
  let availableGbpMinor: number | null = null;
  let interval: string | null = null;
  let webhooks: { covered: string[]; missing: string[] } | null = null;
  const reads: ReadOutcome[] = [];

  try {
    stripeCalled = true;
    const retrieved = await stripe.charges.retrieve(purchase.stripeChargeId, {
      expand: ["balance_transaction"],
    });
    const bt =
      retrieved.balance_transaction && typeof retrieved.balance_transaction === "object"
        ? retrieved.balance_transaction
        : null;
    const shaped = safeChargeFacts({
      id: retrieved.id,
      livemode: retrieved.livemode,
      currency: retrieved.currency,
      grossMinor: retrieved.amount,
      feeMinor: bt && "fee" in bt && typeof bt.fee === "number" ? bt.fee : -1,
      netMinor: bt && "net" in bt && typeof bt.net === "number" ? bt.net : -1,
      balanceStatus: bt && "status" in bt && typeof bt.status === "string" ? bt.status : "unknown",
      availableOn:
        bt && "available_on" in bt && typeof bt.available_on === "number"
          ? new Date(bt.available_on * 1000).toISOString()
          : null,
    });
    if ("blocked" in shaped) {
      reads.push({ name: "charge", status: "mode_mismatch" });
    } else {
      charge = shaped.facts;
      reads.push({ name: "charge", status: "verified" });
      if (bt) {
        const keys = Object.keys(bt).sort();
        const versionReader = stripe as { getApiField?: (key: string) => unknown };
        const apiVersion = versionReader.getApiField?.("version");
        balanceTransaction = {
          apiVersion: typeof apiVersion === "string" ? apiVersion : null,
          object: "object" in bt && typeof bt.object === "string" ? bt.object : null,
          keys,
          payoutPropertyPresent: balanceTransactionObjectHasPayoutProperty(keys),
          type: "type" in bt && typeof bt.type === "string" ? bt.type : null,
          status: "status" in bt && typeof bt.status === "string" ? bt.status : null,
        };
        const btId = "id" in bt && typeof bt.id === "string" ? bt.id : "";
        const funding = await prisma.gpProceedsFunding.findUnique({
          where: { protectedTxnId: purchase.id },
          select: { legs: { select: { stripePayoutId: true } } },
        });
        const ownFundingPayoutIds = (funding?.legs ?? []).map((leg) => leg.stripePayoutId).filter(Boolean);
        const payoutLists = [];
        try {
          const listed = await stripe.payouts.list({ limit: 100 });
          for (const payout of listed.data) {
            if ((payout.currency || "").toLowerCase() !== "gbp") continue;
            if (!payout.automatic) continue;
            if (!["paid", "pending", "in_transit"].includes(String(payout.status || ""))) continue;
            try {
              const bts = await stripe.balanceTransactions.list({ payout: payout.id, limit: 100 });
              payoutLists.push({
                payoutId: payout.id,
                automatic: true as const,
                listed: true,
                balanceTransactionIds: bts.data.map((row) => row.id),
              });
            } catch {
              payoutLists.push({
                payoutId: payout.id,
                automatic: true as const,
                listed: false,
                balanceTransactionIds: [],
              });
            }
          }
        } catch {
          payoutLists.push({
            payoutId: "",
            automatic: true as const,
            listed: false,
            balanceTransactionIds: [],
          });
        }
        const membership = assessChargePayoutMembership({
          balanceTransactionId: btId,
          ownFundingPayoutIds,
          payoutLists,
        });
        automaticPayoutMembership = {
          filterAutomaticOnly: true,
          automaticPayoutsListed: payoutLists.filter((row) => row.listed).length,
          unreadAutomaticPayouts: payoutLists.filter((row) => !row.listed).length,
          chargeBtInNonOwnAutomaticPayout: membership.state === "paid_out",
          membershipState: membership.state,
        };
      }
    }
  } catch (err) {
    reads.push({ name: "charge", status: permissionFailure(err) });
  }

  try {
    stripeCalled = true;
    const balance = await readFinancialAccountBalance("TEST", "gbp");
    if (balance.failureKind === "mode_mismatch" || balance.livemode === true) {
      reads.push({ name: "financial_account_balance", status: "mode_mismatch" });
    } else if (
      balance.rawOk &&
      balance.availableMinor != null &&
      balance.currency === "gbp" &&
      balance.livemode === false
    ) {
      availableGbpMinor = balance.availableMinor;
      reads.push({ name: "financial_account_balance", status: "verified" });
    } else if (balance.httpStatus === 401 || balance.httpStatus === 403) {
      reads.push({ name: "financial_account_balance", status: "permission_denied" });
    } else {
      reads.push({ name: "financial_account_balance", status: "failed" });
    }
  } catch (err) {
    reads.push({ name: "financial_account_balance", status: permissionFailure(err) });
  }

  try {
    stripeCalled = true;
    const account = await stripe.accounts.retrieve();
    const value = account.settings?.payouts?.schedule?.interval;
    interval = typeof value === "string" ? value : null;
    reads.push({ name: "payout_schedule", status: interval ? "verified" : "failed" });
  } catch (err) {
    reads.push({ name: "payout_schedule", status: permissionFailure(err) });
  }

  try {
    stripeCalled = true;
    const enabled: string[] = [];
    let startingAfter = "";
    for (let page = 0; page < 3; page += 1) {
      const list = await stripe.webhookEndpoints.list({
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const endpoint of list.data) {
        if (endpoint.livemode) continue;
        for (const event of endpoint.enabled_events) enabled.push(event);
      }
      if (!list.has_more || list.data.length === 0) break;
      startingAfter = list.data[list.data.length - 1]?.id || "";
      if (!startingAfter) break;
    }
    webhooks = webhookEventCoverage(enabled, PLATFORM_WEBHOOK_EVENTS);
    reads.push({ name: "webhook_endpoints", status: "verified" });
  } catch (err) {
    reads.push({ name: "webhook_endpoints", status: permissionFailure(err) });
  }

  return reportFrom({
    purchaseHash: "597151ee",
    stripeCalled,
    charge,
    balanceTransaction,
    automaticPayoutMembership,
    financialAccountAvailableGbpMinor: availableGbpMinor,
    payoutScheduleInterval: interval,
    webhooks,
    reads,
  });
}

/**
 * Admin-only TEST reads for the damaged GP purchase recovery plan.
 * GET path only. No top-up, payout, quote, refund, or schedule change.
 */

import { prisma } from "@/lib/db";
import { isGlobalPayoutsLiveInitiationEnabled } from "@/lib/payments/flags";
import { getStripe } from "@/lib/payments/stripe/client";
import { readFinancialAccountBalance } from "@/lib/payments/payout-rail/fa-funding";
import {
  assessChargePayoutMembership,
  type ChargePayoutMembership,
} from "@/lib/payments/payout-rail/proceeds-funding";
import {
  idHash8,
  selectDamagedTestPurchase,
  type ApprovedPurchaseRow,
} from "@/lib/payments/payout-rail/proceeds-preflight-shape";
import {
  DAMAGED_GP_TEST_PURCHASE,
  planDamagedGpTestRecovery,
  type DamagedRecoveryPlan,
  type RecoveryMembership,
} from "@/lib/payments/payout-rail/test-recovery-preview";

export type DamagedRecoveryPreview = DamagedRecoveryPlan & {
  ok: true;
  stripeCalled: boolean;
  fundingStatus: string | null;
  failureCode: string | null;
  siblingFundingStatus: string | null;
  cardAvailableGbpMinor: number | null;
  pendingGbpMinor: number | null;
  financialAccountAvailableGbpMinor: number | null;
};

function membershipState(membership: ChargePayoutMembership): RecoveryMembership {
  if (membership.state === "paid_out") return "paid_out";
  if (membership.state === "unread") return "unread";
  return "clear";
}

async function listAutomaticGbpPayoutBts(stripe: ReturnType<typeof getStripe>) {
  const payoutLists: Array<{
    payoutId: string;
    automatic: true;
    listed: boolean;
    balanceTransactionIds: string[];
  }> = [];
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
          automatic: true,
          listed: true,
          balanceTransactionIds: bts.data.map((row) => row.id),
        });
      } catch {
        payoutLists.push({
          payoutId: payout.id,
          automatic: true,
          listed: false,
          balanceTransactionIds: [],
        });
      }
    }
  } catch {
    payoutLists.push({
      payoutId: "",
      automatic: true,
      listed: false,
      balanceTransactionIds: [],
    });
  }
  return payoutLists;
}

export async function runDamagedTestRecoveryPreview(): Promise<DamagedRecoveryPreview> {
  if (isGlobalPayoutsLiveInitiationEnabled()) {
    throw Object.assign(new Error("LIVE GP initiation must stay off"), {
      status: 409,
      code: "GP_LIVE_INITIATION_ON",
    });
  }
  const purchases = await prisma.protectedTransaction.findMany({
    where: {
      stripeMode: "TEST",
      payoutRail: "STRIPE_GLOBAL_PAYOUTS",
      currency: { equals: "GBP", mode: "insensitive" },
      totalChargeMinor: DAMAGED_GP_TEST_PURCHASE.totalChargeMinor,
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
  const purchase = selectDamagedTestPurchase(purchases as ApprovedPurchaseRow[]);
  if (!purchase?.stripeChargeId) {
    throw Object.assign(new Error("Damaged TEST purchase was not found"), { status: 404 });
  }

  const [funding, sibling] = await Promise.all([
    prisma.gpProceedsFunding.findUnique({
      where: { protectedTxnId: purchase.id },
      select: {
        status: true,
        failureCode: true,
        principalMinor: true,
        payoutFeeMinor: true,
        chargeNetMinor: true,
        legs: { select: { status: true, amountMinor: true, stripePayoutId: true } },
      },
    }),
    prisma.gpProceedsFunding.findMany({
      where: { stripeMode: "TEST", currency: "GBP" },
      select: {
        status: true,
        protectedTxnId: true,
        legs: { select: { status: true, amountMinor: true } },
      },
    }),
  ]);

  const siblingRow = sibling.find((row) => idHash8(row.protectedTxnId) === DAMAGED_GP_TEST_PURCHASE.siblingHash);
  const siblingPendingLegMinor = (siblingRow?.legs ?? [])
    .filter((leg) => leg.status === "PENDING")
    .reduce((sum, leg) => sum + leg.amountMinor, 0);
  const postedMinor = (funding?.legs ?? [])
    .filter((leg) => leg.status === "POSTED")
    .reduce((sum, leg) => sum + leg.amountMinor, 0);
  const pendingMinor = (funding?.legs ?? [])
    .filter((leg) => leg.status === "PENDING")
    .reduce((sum, leg) => sum + leg.amountMinor, 0);

  const stripe = getStripe("TEST");
  let stripeCalled = false;
  let membership: ChargePayoutMembership = { state: "unread", code: "GP_CHARGE_PAYOUT_UNREAD" };
  let cardAvailableGbpMinor: number | null = null;
  let pendingGbpMinor: number | null = null;
  let financialAccountAvailableGbpMinor: number | null = null;

  try {
    stripeCalled = true;
    const retrieved = await stripe.charges.retrieve(purchase.stripeChargeId, {
      expand: ["balance_transaction"],
    });
    if (retrieved.livemode) {
      throw Object.assign(new Error("TEST recovery refused a live charge"), { status: 409 });
    }
    const bt =
      retrieved.balance_transaction && typeof retrieved.balance_transaction === "object"
        ? retrieved.balance_transaction
        : null;
    const btId = bt && "id" in bt && typeof bt.id === "string" ? bt.id : "";
    membership = assessChargePayoutMembership({
      balanceTransactionId: btId,
      ownFundingPayoutIds: (funding?.legs ?? []).map((leg) => leg.stripePayoutId).filter(Boolean),
      payoutLists: await listAutomaticGbpPayoutBts(stripe),
    });
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number(err.status) : 0;
    if (status === 409) throw err;
    membership = { state: "unread", code: "GP_CHARGE_PAYOUT_UNREAD" };
  }

  try {
    stripeCalled = true;
    const balance = await stripe.balance.retrieve();
    const gbp = balance.available.find((entry) => entry.currency === "gbp");
    const pending = balance.pending.find((entry) => entry.currency === "gbp");
    cardAvailableGbpMinor =
      gbp && "source_types" in gbp && gbp.source_types && typeof gbp.source_types.card === "number"
        ? gbp.source_types.card
        : (gbp?.amount ?? null);
    pendingGbpMinor = pending?.amount ?? null;
  } catch {
    cardAvailableGbpMinor = null;
  }

  try {
    stripeCalled = true;
    const fa = await readFinancialAccountBalance("TEST", "gbp");
    if (fa.rawOk && fa.livemode === false && fa.availableMinor != null) {
      financialAccountAvailableGbpMinor = fa.availableMinor;
    }
  } catch {
    financialAccountAvailableGbpMinor = null;
  }

  const leftoverAvailableMinor =
    cardAvailableGbpMinor == null ? DAMAGED_GP_TEST_PURCHASE.leftoverAvailableMinor : cardAvailableGbpMinor;
  const plan = planDamagedGpTestRecovery({
    membershipState: membershipState(membership),
    postedMinor,
    pendingMinor,
    leftoverAvailableMinor,
    siblingPendingLegMinor,
    liveInitiationEnabled: false,
  });

  return {
    ...plan,
    ok: true,
    stripeCalled,
    fundingStatus: funding?.status ?? null,
    failureCode: funding?.failureCode || null,
    siblingFundingStatus: siblingRow?.status ?? null,
    cardAvailableGbpMinor,
    pendingGbpMinor,
    financialAccountAvailableGbpMinor,
  };
}

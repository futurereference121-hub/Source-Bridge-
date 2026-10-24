/**
 * Admin-only TEST recovery reads, plus retrieve-only sibling-leg confirm.
 * Confirm persists POSTED only after matchFundingCredit finds one ReceivedCredit.
 * No top-up, funding payout, quote, refund, or schedule change.
 */

import { prisma } from "@/lib/db";
import { isGlobalPayoutsLiveInitiationEnabled } from "@/lib/payments/flags";
import { getStripe } from "@/lib/payments/stripe/client";
import { readFinancialAccountBalance } from "@/lib/payments/payout-rail/fa-funding";
import {
  assessChargePayoutMembership,
  matchFundingCredit,
  redactReceivedCreditInventory,
  type ChargePayoutMembership,
} from "@/lib/payments/payout-rail/proceeds-funding";
import { getGlobalPayoutsFinancialAccountId, gpFetch } from "@/lib/payments/payout-rail/gp-client";
import {
  idHash8,
  last5,
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
  creditInventory: ReturnType<typeof redactReceivedCreditInventory> | null;
  siblingPayoutStatus: string | null;
  siblingMatchFound: boolean;
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
        legs: { select: { status: true, amountMinor: true, stripePayoutId: true, faCreditId: true } },
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

  let creditInventory: ReturnType<typeof redactReceivedCreditInventory> | null = null;
  let siblingPayoutStatus: string | null = null;
  let siblingMatchFound = false;
  const siblingLeg = (siblingRow?.legs ?? []).find(
    (leg) =>
      leg.status === "PENDING" &&
      leg.amountMinor === DAMAGED_GP_TEST_PURCHASE.siblingConsumedMinor &&
      leg.stripePayoutId,
  );
  try {
    stripeCalled = true;
    const credits = await listTestReceivedCredits();
    const claimed = (
      await prisma.gpProceedsFundingLeg.findMany({
        where: { faCreditId: { not: "" } },
        select: { faCreditId: true },
      })
    ).map((row) => row.faCreditId);
    creditInventory = redactReceivedCreditInventory({
      credits,
      financialAccountId: getGlobalPayoutsFinancialAccountId("TEST"),
      amountMinor: DAMAGED_GP_TEST_PURCHASE.siblingConsumedMinor,
      claimedCreditIds: claimed,
    });
    if (siblingLeg?.stripePayoutId) {
      const payout = await getStripe("TEST").payouts.retrieve(siblingLeg.stripePayoutId);
      if (!payout.livemode) {
        siblingPayoutStatus = payout.status;
        siblingMatchFound = Boolean(
          matchFundingCredit({
            payoutId: payout.id,
            financialAccountId: getGlobalPayoutsFinancialAccountId("TEST"),
            amountMinor: siblingLeg.amountMinor,
            currency: DAMAGED_GP_TEST_PURCHASE.currency,
            payoutStatus: payout.status,
            livemode: false,
            credits,
            claimedCreditIds: claimed,
          }),
        );
      }
    }
  } catch {
    creditInventory = creditInventory ?? null;
  }

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
    creditInventory,
    siblingPayoutStatus,
    siblingMatchFound,
  };
}

async function listTestReceivedCredits(): Promise<Record<string, unknown>[]> {
  const credits: Record<string, unknown>[] = [];
  let path = "/v2/money_management/received_credits?limit=100";
  for (let page = 0; page < 10 && path; page += 1) {
    const listed = await gpFetch({ mode: "TEST", method: "GET", path });
    if (!listed.ok || !Array.isArray(listed.body.data)) break;
    credits.push(...(listed.body.data as Record<string, unknown>[]));
    const next = typeof listed.body.next_page_url === "string" ? listed.body.next_page_url : "";
    path = next ? next.replace("https://api.stripe.com", "") : "";
    if (!listed.body.has_more && !next) path = "";
  }
  return credits;
}

export async function confirmTestSiblingFundingLeg(): Promise<{
  ok: true;
  purchaseHash: "597151ee";
  wrote: boolean;
  payoutStatus: string | null;
  payoutPaidAloneInsufficient: boolean;
  matchFound: boolean;
  creditSuffix: string;
  fundingStatus: string | null;
  fundingStatusAfter: string | null;
  siblingPendingLegMinorAfter: number;
}> {
  if (isGlobalPayoutsLiveInitiationEnabled()) {
    throw Object.assign(new Error("LIVE GP initiation must stay off"), {
      status: 409,
      code: "GP_LIVE_INITIATION_ON",
    });
  }
  const rows = await prisma.gpProceedsFunding.findMany({
    where: { stripeMode: "TEST", currency: "GBP" },
    select: {
      id: true,
      status: true,
      principalMinor: true,
      payoutFeeMinor: true,
      protectedTxnId: true,
      legs: {
        select: {
          id: true,
          status: true,
          amountMinor: true,
          currency: true,
          stripePayoutId: true,
          stripePayoutStatus: true,
          faCreditId: true,
        },
      },
    },
  });
  const sibling = rows.find((row) => idHash8(row.protectedTxnId) === DAMAGED_GP_TEST_PURCHASE.siblingHash);
  if (!sibling) {
    throw Object.assign(new Error("Sibling TEST purchase was not found"), { status: 404 });
  }
  const leg = sibling.legs.find(
    (row) =>
      row.status === "PENDING" &&
      row.amountMinor === DAMAGED_GP_TEST_PURCHASE.siblingConsumedMinor &&
      row.stripePayoutId,
  );
  if (!leg?.stripePayoutId) {
    return {
      ok: true,
      purchaseHash: "597151ee",
      wrote: false,
      payoutStatus: null,
      payoutPaidAloneInsufficient: false,
      matchFound: false,
      creditSuffix: "",
      fundingStatus: sibling.status,
      fundingStatusAfter: sibling.status,
      siblingPendingLegMinorAfter: sibling.legs
        .filter((row) => row.status === "PENDING")
        .reduce((sum, row) => sum + row.amountMinor, 0),
    };
  }

  const payout = await getStripe("TEST").payouts.retrieve(leg.stripePayoutId);
  if (payout.livemode) {
    throw Object.assign(new Error("TEST recovery refused a live payout"), { status: 409 });
  }
  const credits = await listTestReceivedCredits();
  const claimed = (
    await prisma.gpProceedsFundingLeg.findMany({
      where: { faCreditId: { not: "" } },
      select: { faCreditId: true },
    })
  ).map((row) => row.faCreditId);
  const match = matchFundingCredit({
    payoutId: payout.id,
    financialAccountId: getGlobalPayoutsFinancialAccountId("TEST"),
    amountMinor: leg.amountMinor,
    currency: leg.currency,
    payoutStatus: payout.status,
    livemode: false,
    credits,
    claimedCreditIds: claimed,
  });
  if (!match) {
    return {
      ok: true,
      purchaseHash: "597151ee",
      wrote: false,
      payoutStatus: payout.status,
      payoutPaidAloneInsufficient: payout.status === "paid",
      matchFound: false,
      creditSuffix: "",
      fundingStatus: sibling.status,
      fundingStatusAfter: sibling.status,
      siblingPendingLegMinorAfter: sibling.legs
        .filter((row) => row.status === "PENDING")
        .reduce((sum, row) => sum + row.amountMinor, 0),
    };
  }

  await prisma.gpProceedsFundingLeg.update({
    where: { id: leg.id },
    data: {
      status: "POSTED",
      stripePayoutStatus: payout.status,
      faCreditId: match.creditId,
      postedAt: new Date(),
    },
  });
  const requiredMinor = sibling.principalMinor + sibling.payoutFeeMinor;
  const postedMinor = sibling.legs
    .filter((row) => row.status === "POSTED" || row.id === leg.id)
    .reduce((sum, row) => sum + row.amountMinor, 0);
  if (postedMinor >= requiredMinor && requiredMinor > 0) {
    await prisma.gpProceedsFunding.update({
      where: { id: sibling.id },
      data: { status: "POSTED", failureCode: "" },
    });
  }
  const fresh = await prisma.gpProceedsFunding.findUnique({
    where: { id: sibling.id },
    select: { status: true, legs: { select: { status: true, amountMinor: true } } },
  });
  return {
    ok: true,
    purchaseHash: "597151ee",
    wrote: true,
    payoutStatus: payout.status,
    payoutPaidAloneInsufficient: false,
    matchFound: true,
    creditSuffix: last5(match.creditId),
    fundingStatus: sibling.status,
    fundingStatusAfter: fresh?.status ?? sibling.status,
    siblingPendingLegMinorAfter: (fresh?.legs ?? [])
      .filter((row) => row.status === "PENDING")
      .reduce((sum, row) => sum + row.amountMinor, 0),
  };
}

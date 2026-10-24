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
  fundingRowAfterCompletedPurchase,
  matchFundingCredit,
  redactReceivedCreditInventory,
  type ChargePayoutMembership,
} from "@/lib/payments/payout-rail/proceeds-funding";
import { getGlobalPayoutsFinancialAccountId } from "@/lib/payments/payout-rail/gp-client";
import { listReceivedCredits, retrieveReceivedCredit } from "@/lib/payments/payout-rail/received-credits";
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
  siblingFailureCode: string | null;
  siblingPostedLegMinor: number;
  siblingPostedHaveCredit: boolean;
  creditListHttpStatus: number | null;
  creditListErrorCode: string | null;
  storedCreditRetrieved: boolean;
  storedCreditHttpStatus: number | null;
  storedCreditVerified: boolean;
  storedCreditSuffix: string;
  storedTransferKeys: string[];
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
        failureCode: true,
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
  let creditListHttpStatus: number | null = null;
  let creditListErrorCode: string | null = null;
  let siblingPayoutStatus: string | null = null;
  let siblingMatchFound = false;
  let storedCreditRetrieved = false;
  let storedCreditHttpStatus: number | null = null;
  let storedCreditVerified = false;
  let storedCreditSuffix = "";
  let storedTransferKeys: string[] = [];
  const siblingPendingLeg = (siblingRow?.legs ?? []).find(
    (leg) =>
      leg.status === "PENDING" &&
      leg.amountMinor === DAMAGED_GP_TEST_PURCHASE.siblingConsumedMinor &&
      leg.stripePayoutId,
  );
  const siblingPostedLeg = (siblingRow?.legs ?? []).find(
    (leg) =>
      leg.status === "POSTED" &&
      leg.amountMinor === DAMAGED_GP_TEST_PURCHASE.siblingConsumedMinor &&
      leg.faCreditId &&
      leg.stripePayoutId,
  );
  try {
    stripeCalled = true;
    const listed = await listReceivedCredits("TEST");
    creditListHttpStatus = listed.httpStatus;
    creditListErrorCode = listed.errorCode;
    const claimed = (
      await prisma.gpProceedsFundingLeg.findMany({
        where: { faCreditId: { not: "" } },
        select: { faCreditId: true },
      })
    ).map((row) => row.faCreditId);
    creditInventory = redactReceivedCreditInventory({
      credits: listed.credits,
      financialAccountId: getGlobalPayoutsFinancialAccountId("TEST"),
      amountMinor: DAMAGED_GP_TEST_PURCHASE.siblingConsumedMinor,
      claimedCreditIds: claimed,
    });
    const inspectLeg = siblingPendingLeg || siblingPostedLeg;
    if (inspectLeg?.stripePayoutId) {
      const payout = await getStripe("TEST").payouts.retrieve(inspectLeg.stripePayoutId);
      if (!payout.livemode) {
        siblingPayoutStatus = payout.status;
        siblingMatchFound = Boolean(
          matchFundingCredit({
            payoutId: payout.id,
            financialAccountId: getGlobalPayoutsFinancialAccountId("TEST"),
            amountMinor: inspectLeg.amountMinor,
            currency: DAMAGED_GP_TEST_PURCHASE.currency,
            payoutStatus: payout.status,
            livemode: false,
            credits: listed.credits,
            claimedCreditIds: inspectLeg.status === "POSTED" ? [] : claimed,
          }),
        );
        if (siblingPostedLeg?.faCreditId) {
          const retrieved = await retrieveReceivedCredit("TEST", siblingPostedLeg.faCreditId);
          storedCreditHttpStatus = retrieved.httpStatus;
          storedCreditRetrieved = Boolean(retrieved.credit);
          if (retrieved.credit) {
            const transfer = retrieved.credit.balance_transfer;
            storedTransferKeys =
              transfer && typeof transfer === "object" ? Object.keys(transfer).sort() : [];
            storedCreditSuffix = last5(String(retrieved.credit.id || ""));
            storedCreditVerified = Boolean(
              matchFundingCredit({
                payoutId: payout.id,
                financialAccountId: getGlobalPayoutsFinancialAccountId("TEST"),
                amountMinor: siblingPostedLeg.amountMinor,
                currency: DAMAGED_GP_TEST_PURCHASE.currency,
                payoutStatus: payout.status,
                livemode: false,
                credits: [retrieved.credit],
                claimedCreditIds: [],
              }),
            );
          }
        }
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
    siblingFailureCode: siblingRow?.failureCode || null,
    siblingPostedLegMinor: (siblingRow?.legs ?? [])
      .filter((leg) => leg.status === "POSTED")
      .reduce((sum, leg) => sum + leg.amountMinor, 0),
    siblingPostedHaveCredit: (() => {
      const posted = (siblingRow?.legs ?? []).filter((leg) => leg.status === "POSTED");
      return posted.length > 0 && posted.every((leg) => Boolean(leg.faCreditId));
    })(),
    creditListHttpStatus,
    creditListErrorCode,
    storedCreditRetrieved,
    storedCreditHttpStatus,
    storedCreditVerified,
    storedCreditSuffix,
    storedTransferKeys,
    cardAvailableGbpMinor,
    pendingGbpMinor,
    financialAccountAvailableGbpMinor,
    creditInventory,
    siblingPayoutStatus,
    siblingMatchFound,
  };
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
    const posted = sibling.legs.find(
      (row) =>
        row.status === "POSTED" &&
        row.amountMinor === DAMAGED_GP_TEST_PURCHASE.siblingConsumedMinor &&
        row.faCreditId &&
        row.stripePayoutId,
    );
    if (!posted?.stripePayoutId || !posted.faCreditId) {
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
    const payout = await getStripe("TEST").payouts.retrieve(posted.stripePayoutId);
    if (payout.livemode) {
      throw Object.assign(new Error("TEST recovery refused a live payout"), { status: 409 });
    }
    const retrieved = await retrieveReceivedCredit("TEST", posted.faCreditId);
    const match = retrieved.credit
      ? matchFundingCredit({
          payoutId: payout.id,
          financialAccountId: getGlobalPayoutsFinancialAccountId("TEST"),
          amountMinor: posted.amountMinor,
          currency: posted.currency,
          payoutStatus: payout.status,
          livemode: false,
          credits: [retrieved.credit],
          claimedCreditIds: [],
        })
      : null;
    const requiredMinor = sibling.principalMinor + sibling.payoutFeeMinor;
    const postedMinor = sibling.legs
      .filter((row) => row.status === "POSTED")
      .reduce((sum, row) => sum + row.amountMinor, 0);
    const resolved = match
      ? fundingRowAfterCompletedPurchase({
          postedMinor,
          pendingMinor: 0,
          requiredMinor,
          postedLegsHaveCredit: true,
        })
      : { status: "unchanged" as const };
    if (resolved.status === "POSTED" && sibling.status !== "POSTED") {
      await prisma.gpProceedsFunding.update({
        where: { id: sibling.id },
        data: { status: "POSTED", failureCode: "" },
      });
    }
    return {
      ok: true,
      purchaseHash: "597151ee",
      wrote: resolved.status === "POSTED" && sibling.status !== "POSTED",
      payoutStatus: payout.status,
      payoutPaidAloneInsufficient: payout.status === "paid" && !match,
      matchFound: Boolean(match),
      creditSuffix: match ? last5(match.creditId) : "",
      fundingStatus: sibling.status,
      fundingStatusAfter: resolved.status === "POSTED" ? "POSTED" : sibling.status,
      siblingPendingLegMinorAfter: 0,
    };
  }

  const payout = await getStripe("TEST").payouts.retrieve(leg.stripePayoutId);
  if (payout.livemode) {
    throw Object.assign(new Error("TEST recovery refused a live payout"), { status: 409 });
  }
  const listed = await listReceivedCredits("TEST");
  const credits = listed.credits;
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

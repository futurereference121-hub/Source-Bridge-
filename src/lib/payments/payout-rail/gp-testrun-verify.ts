/**
 * Read-only TEST verification of the current Oct 25 GP purchase funding, plus
 * optional attach-only recovery of its uncertain FINAL outbound.
 * Uses the runtime TEST Stripe client. Never creates a new idempotency key.
 */

import { prisma } from "@/lib/db";
import { isGlobalPayoutsLiveInitiationEnabled } from "@/lib/payments/flags";
import { getStripe } from "@/lib/payments/stripe/client";
import { getGlobalPayoutsFinancialAccountId } from "@/lib/payments/payout-rail/gp-client";
import { matchFundingCredit } from "@/lib/payments/payout-rail/proceeds-funding";
import { listReceivedCredits, retrieveReceivedCredit } from "@/lib/payments/payout-rail/received-credits";
import {
  listUncertainOutboundEvidence,
  recoverUncertainInitiatedOutbound,
} from "@/lib/payments/payout-rail/outbound-payment";
import { matchUncertainOutboundFromList } from "@/lib/payments/payout-rail/outbound-quote";
import { idHash8, last5 } from "@/lib/payments/payout-rail/proceeds-preflight-shape";

export const CURRENT_GP_TEST_RUN = {
  txnHash: "28ce7ec2",
  payoutSuffix: "TaHJ9",
  creditSuffix: "JsTou",
  stripeMode: "TEST" as const,
  payoutRail: "STRIPE_GLOBAL_PAYOUTS",
  currency: "GBP",
  totalChargeMinor: 4025,
  createdOnOrAfter: "2026-10-25T00:00:00.000Z",
};

function assertLiveInitiationOff() {
  if (isGlobalPayoutsLiveInitiationEnabled()) {
    throw Object.assign(new Error("LIVE GP initiation must stay off"), {
      status: 409,
      code: "GP_LIVE_INITIATION_ON",
    });
  }
}

async function loadCurrentTestRun() {
  const rows = await prisma.protectedTransaction.findMany({
    where: {
      stripeMode: CURRENT_GP_TEST_RUN.stripeMode,
      payoutRail: CURRENT_GP_TEST_RUN.payoutRail,
      totalChargeMinor: CURRENT_GP_TEST_RUN.totalChargeMinor,
      createdAt: { gte: new Date(CURRENT_GP_TEST_RUN.createdOnOrAfter) },
    },
    include: {
      gpProceedsFunding: { include: { legs: true } },
      outboundPaymentAttempts: { orderBy: { updatedAt: "desc" }, take: 2 },
    },
  });
  const purchase = rows.find((row) => idHash8(row.id) === CURRENT_GP_TEST_RUN.txnHash);
  if (!purchase || purchase.stripeMode !== "TEST") {
    throw Object.assign(new Error("Current TEST purchase was not found"), { status: 404 });
  }
  return purchase;
}

export async function verifyCurrentTestRunFunding() {
  assertLiveInitiationOff();
  const purchase = await loadCurrentTestRun();
  const funding = purchase.gpProceedsFunding;
  const leg =
    (funding?.legs || []).find((row) => last5(row.faCreditId) === CURRENT_GP_TEST_RUN.creditSuffix) ||
    (funding?.legs || [])[0] ||
    null;
  const attempt = purchase.outboundPaymentAttempts[0] || null;
  const faId = getGlobalPayoutsFinancialAccountId("TEST");
  const stripe = getStripe("TEST");

  let payout: {
    http: number | null;
    livemode: boolean | null;
    status: string | null;
    amountMinor: number | null;
    currency: string | null;
    suffix: string;
    destinationSuffix: string;
  } | null = null;
  let credit: {
    http: number | null;
    retrieved: boolean;
    suffix: string;
    type: string | null;
    status: string | null;
    livemode: boolean | null;
    faSuffix: string;
    amountMinor: number | null;
    currency: string | null;
  } | null = null;
  let match: {
    payoutPaid: boolean;
    retrievedCredit: boolean;
    listedCredit: boolean;
  } | null = null;

  if (leg?.stripePayoutId) {
    const retrieved = await stripe.payouts.retrieve(leg.stripePayoutId);
    payout = {
      http: 200,
      livemode: retrieved.livemode,
      status: retrieved.status,
      amountMinor: retrieved.amount,
      currency: retrieved.currency,
      suffix: last5(retrieved.id),
      destinationSuffix: last5(String(retrieved.destination || "")),
    };
    const listed = await listReceivedCredits("TEST");
    const retrievedCredit = leg.faCreditId
      ? await retrieveReceivedCredit("TEST", leg.faCreditId)
      : { credit: null, httpStatus: null, errorCode: "missing_id" };
    const creditRow = retrievedCredit.credit;
    const amount =
      creditRow?.amount && typeof creditRow.amount === "object"
        ? (creditRow.amount as { value?: unknown; currency?: unknown })
        : {};
    credit = {
      http: retrievedCredit.httpStatus,
      retrieved: Boolean(creditRow),
      suffix: last5(String(creditRow?.id || "")),
      type: typeof creditRow?.type === "string" ? creditRow.type : null,
      status: typeof creditRow?.status === "string" ? creditRow.status : null,
      livemode: typeof creditRow?.livemode === "boolean" ? creditRow.livemode : null,
      faSuffix: last5(String(creditRow?.financial_account || "")),
      amountMinor: typeof amount.value === "number" ? amount.value : null,
      currency: typeof amount.currency === "string" ? amount.currency : null,
    };
    match = {
      payoutPaid: retrieved.status === "paid" && retrieved.livemode === false,
      retrievedCredit: Boolean(
        creditRow &&
          matchFundingCredit({
            payoutId: retrieved.id,
            financialAccountId: faId,
            amountMinor: leg.amountMinor,
            currency: purchase.currency,
            payoutStatus: retrieved.status,
            livemode: false,
            credits: [creditRow],
            claimedCreditIds: [],
          }),
      ),
      listedCredit: Boolean(
        matchFundingCredit({
          payoutId: retrieved.id,
          financialAccountId: faId,
          amountMinor: leg.amountMinor,
          currency: purchase.currency,
          payoutStatus: retrieved.status,
          livemode: false,
          credits: listed.credits,
          claimedCreditIds: [],
        }),
      ),
    };
  }

  const listedOutbound = attempt
    ? await listUncertainOutboundEvidence(
        "TEST",
        attempt.stripeRecipientId,
        attempt.stripeFinancialAccountId || faId,
      )
    : { complete: false, payments: [] };
  const outboundMatch = attempt
    ? matchUncertainOutboundFromList({
        complete: listedOutbound.complete,
        payments: listedOutbound.payments,
        protectedTxnId: purchase.id,
        kind: attempt.kind === "PROCUREMENT" ? "PROCUREMENT" : "FINAL",
        recipientId: attempt.stripeRecipientId,
        payoutMethodId: attempt.stripePayoutMethodId,
        financialAccountId: attempt.stripeFinancialAccountId || faId,
        amountMinor: attempt.amountMinor,
        currency: attempt.currency,
      })
    : { action: "wait" as const, code: "GP_RECONCILIATION_INCOMPLETE" as const };

  return {
    ok: true,
    stripeCalled: true,
    purchaseHash: CURRENT_GP_TEST_RUN.txnHash,
    status: purchase.status,
    agreed: purchase.procurementAdvanceAgreed,
    advanceMinor: purchase.procurementAdvanceMinor,
    fundingStatus: funding?.status ?? null,
    fundingFailure: funding?.failureCode || "",
    postedGuardHeld:
      funding?.status === "POSTED" &&
      !funding.failureCode &&
      (funding.legs || []).some(
        (row) =>
          row.status === "POSTED" &&
          last5(row.stripePayoutId) === CURRENT_GP_TEST_RUN.payoutSuffix &&
          last5(row.faCreditId) === CURRENT_GP_TEST_RUN.creditSuffix,
      ),
    payout,
    credit,
    match,
    outbound: attempt
      ? {
          kind: attempt.kind,
          status: attempt.status,
          amountMinor: attempt.amountMinor,
          initiatedAt: attempt.initiatedAt,
          hasProviderId: Boolean(attempt.stripeOutboundPaymentId),
          outboundSuffix: last5(attempt.stripeOutboundPaymentId),
          attemptCount: attempt.attemptCount,
          idempotencyHash8: idHash8(attempt.idempotencyKey),
          destCurrency: attempt.destinationCurrency,
          destAmountMinor: attempt.destinationAmountMinor,
          listComplete: listedOutbound.complete,
          listedCount: listedOutbound.payments.length,
          matchAction: outboundMatch.action,
          matchCode: outboundMatch.action === "wait" ? outboundMatch.code : "",
          matchedSuffix:
            outboundMatch.action === "attach" ? last5(outboundMatch.outboundId) : "",
        }
      : null,
  };
}

export async function recoverCurrentTestRunOutbound() {
  assertLiveInitiationOff();
  const purchase = await loadCurrentTestRun();
  const attempt = purchase.outboundPaymentAttempts[0];
  if (!attempt) {
    throw Object.assign(new Error("Outbound attempt was not found"), { status: 404 });
  }
  const recovered = await recoverUncertainInitiatedOutbound(attempt);
  return {
    ok: true,
    purchaseHash: CURRENT_GP_TEST_RUN.txnHash,
    attached: recovered.attached,
    finalized: recovered.finalized,
    outboundSuffix: last5(recovered.outboundId),
    code: recovered.code,
  };
}

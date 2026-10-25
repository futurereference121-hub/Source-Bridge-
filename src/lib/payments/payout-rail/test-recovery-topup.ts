/**
 * TEST platform payments-balance top-up for the damaged GP purchase.
 * Not a buyer PaymentIntent. Not a financial-account credit. LIVE unused.
 */

import { isGlobalPayoutsLiveInitiationEnabled } from "@/lib/payments/flags";
import { getStripe } from "@/lib/payments/stripe/client";
import { prisma } from "@/lib/db";
import { last5, selectDamagedTestPurchase } from "@/lib/payments/payout-rail/proceeds-preflight-shape";
import {
  DAMAGED_GP_TEST_PURCHASE,
  decideTestRepairTopupAmount,
} from "@/lib/payments/payout-rail/test-recovery-preview";
import { runDamagedTestRecoveryPreview } from "@/lib/payments/payout-rail/test-recovery-run";
import { parseQuoteSnapshot } from "@/lib/payments/payout-rail/outbound-quote";

export { TEST_REPAIR_TOPUP_CAP_MINOR, decideTestRepairTopupAmount } from "@/lib/payments/payout-rail/test-recovery-preview";

export async function executeTestPlatformBalanceRepair(opts: {
  confirmed: true;
}): Promise<Record<string, unknown>> {
  if (opts.confirmed !== true) {
    throw Object.assign(new Error("Confirmation required"), { status: 400 });
  }
  if (isGlobalPayoutsLiveInitiationEnabled()) {
    throw Object.assign(new Error("LIVE GP initiation must stay off"), { status: 409 });
  }
  const preview = await runDamagedTestRecoveryPreview();
  const decision = decideTestRepairTopupAmount({
    requiredMinor: preview.requiredMinor,
    leftoverAvailableMinor: preview.leftoverAvailableMinor,
  });
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
      outboundPaymentAttempts: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { status: true, fxRateSnapshot: true, amountMinor: true },
      },
    },
  });
  const purchase = selectDamagedTestPurchase(purchases);
  const attempt = purchase?.outboundPaymentAttempts?.[0];
  const quote = parseQuoteSnapshot(attempt?.fxRateSnapshot || "");
  const quoteCover = {
    outboundStatus: attempt?.status || null,
    quoteIdSuffix: quote?.quoteId ? last5(quote.quoteId) : "",
    sourceAmountMinor: quote?.sourceAmountMinor ?? attempt?.amountMinor ?? null,
    expiresAt: quote?.expiresAt || null,
    expired: Boolean(quote?.expiresAt && Date.parse(quote.expiresAt) <= Date.now()),
  };

  const base = {
    ok: true as const,
    stripeMode: "TEST" as const,
    liveInitiationEnabled: false,
    purchaseHash: preview.purchaseHash,
    siblingHash: preview.siblingHash,
    siblingFundingStatus: preview.siblingFundingStatus,
    siblingPostedHaveCredit: preview.siblingPostedHaveCredit,
    storedCreditVerified: preview.storedCreditVerified,
    storedCreditSuffix: preview.storedCreditSuffix,
    membershipState: preview.membershipState,
    fundingStatus: preview.fundingStatus,
    requiredMinor: preview.requiredMinor,
    leftoverAvailableMinor: preview.leftoverAvailableMinor,
    cardAvailableGbpMinor: preview.cardAvailableGbpMinor,
    pendingGbpMinor: preview.pendingGbpMinor,
    financialAccountAvailableGbpMinor: preview.financialAccountAvailableGbpMinor,
    quoteCover,
    decision,
  };

  if (preview.membershipState !== "clear") {
    return { ...base, executed: false, reason: "MEMBERSHIP_NOT_CLEAR" };
  }
  if (preview.siblingFundingStatus !== "POSTED" || !preview.storedCreditVerified) {
    return { ...base, executed: false, reason: "SIBLING_NOT_VERIFIED" };
  }
  if (preview.pendingMinor > 0 || preview.siblingPendingLegMinor > 0) {
    return { ...base, executed: false, reason: "PENDING_LEG" };
  }
  if (decision.action === "none") {
    return { ...base, executed: false, reason: decision.code };
  }
  if (decision.action === "stop") {
    return { ...base, executed: false, reason: decision.code };
  }

  const stripe = getStripe("TEST");
  const before = await stripe.balance.retrieve();
  if (before.livemode) {
    throw Object.assign(new Error("TEST repair refused a live account"), { status: 409 });
  }
  const account = await stripe.accounts.retrieve();
  if (String(account.id || "").slice(-4) !== "MV9g") {
    throw Object.assign(new Error("TEST repair refused an unexpected account"), { status: 409 });
  }

  let topup;
  try {
    topup = await stripe.topups.create(
      {
        amount: decision.amountMinor,
        currency: "gbp",
        description: "TEST platform payments-balance repair b8444fb7; not a buyer payment",
        statement_descriptor: "SB TEST REPAIR",
        metadata: {
          purpose: "TEST_REPAIR_PLATFORM_BALANCE",
          purchaseHash: DAMAGED_GP_TEST_PURCHASE.txnHash,
          substitute: "true",
          ownChargeProof: "false",
        },
      },
      { idempotencyKey: `sb_test_repair_${DAMAGED_GP_TEST_PURCHASE.txnHash}_${decision.amountMinor}` },
    );
  } catch (err) {
    const e = err && typeof err === "object" ? (err as { type?: string; code?: string; message?: string }) : {};
    return {
      ...base,
      executed: false,
      reason: "TOPUP_UNSUPPORTED",
      stripeType: e.type || null,
      stripeCode: e.code || null,
      stripeMessage: String(e.message || "").slice(0, 180),
    };
  }
  if (topup.livemode) {
    throw Object.assign(new Error("TEST repair refused a live top-up"), { status: 409 });
  }

  const after = await stripe.balance.retrieve();
  const gbp = after.available.find((row) => row.currency === "gbp");
  const cardAfter =
    gbp && "source_types" in gbp && gbp.source_types && typeof gbp.source_types.card === "number"
      ? gbp.source_types.card
      : (gbp?.amount ?? null);

  return {
    ...base,
    executed: true,
    reason: "TOPUP_CREATED",
    topupSuffix: last5(topup.id),
    topupStatus: topup.status,
    topupAmountMinor: topup.amount,
    expectedAvailability: topup.expected_availability_date || null,
    cardAvailableAfterMinor: cardAfter,
    substitute: true,
    ownChargeProof: false,
  };
}

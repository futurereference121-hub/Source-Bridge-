/**
 * Global Payouts OutboundPayment release path — isolated from Connect transfers.create.
 * Platform absorbs GP fees; sourcer entitlement amount unchanged.
 * Never fall through to Connect. Never dual-pay.
 */

import { prisma } from "@/lib/db";
import { appendLedgerEntry, recordAuditEvent } from "@/lib/payments/ledger";
import {
  assertStripeModeCompatible,
  isGlobalPayoutsEnabled,
  isPaymentsEnabled,
  normalizeStripeMode,
} from "@/lib/payments/flags";
import { isStripeConfigured } from "@/lib/payments/stripe/client";
import {
  canTransition,
  nextStatus,
  type DomainAction,
  type ProtectedStatus,
} from "@/lib/payments/state-machine";
import { markListingSoldIfLinked } from "@/lib/payments/listing-lifecycle";
import { isDirectPaymentOption } from "@/lib/payments/payment-option";
import {
  assertFinalReleaseInvariants,
  assertProcurementReleaseInvariants,
  computeProtectedFinancials,
} from "@/lib/payments/breakdown";
import { afterProtectedTxnMoneyEvent } from "@/lib/payments/ticket-mutation-sync";
import { lockedPayoutRailFromTxn } from "@/lib/payments/payout-rail/rail-resolver";
import {
  ensureFinancialAccountFunding,
  readFinancialAccountBalance,
} from "@/lib/payments/payout-rail/fa-funding";
import {
  getGlobalPayoutsFinancialAccountId,
  gpFetch,
} from "@/lib/payments/payout-rail/gp-client";
import {
  assessAttemptPreservation,
  correctedQuoteRetryKey,
  evaluateQuoteRoute,
  executeQuotedPayout,
  financialAccountCountry,
  mergeAttemptNote,
  mergeStoredQuoteSnapshot,
  parseGpProviderError,
  parseQuoteSnapshot,
  payoutMethodCountry,
  payoutMethodCurrencies,
  proveNoExistingOutboundPayment,
  providerErrorRecord,
  resolveDestinationCurrency,
  runCorrectedQuoteRetry,
  type ListedOutboundPayment,
  type QuoteSnapshot,
  type RetryAttemptRecord,
} from "@/lib/payments/payout-rail/outbound-quote";
import {
  canInitiateGlobalPayoutsMoney,
  isGlobalPayoutsCountryAllowed,
} from "@/lib/payments/payout-rail/eligibility";
import {
  evaluateLivePilotInitiation,
  evaluatePilotOccupancy,
  evaluateQuoteConfirmation,
  LIVE_PILOT_LOCK_KEY,
  pilotFailureIsSticky,
  quotedPayoutCover,
} from "@/lib/payments/payout-rail/live-pilot";
import { evaluateSandboxReleaseLimits } from "@/lib/payments/payout-rail/sandbox-pair";
import {
  mapOutboundPaymentProviderStatus,
  outboundPaymentIsUnderReview,
  underReviewBlocksFinalization,
} from "@/lib/payments/payout-rail/status-mapper";
import {
  assertNoConnectTransferSucceeded,
  hasGpSucceeded,
} from "@/lib/payments/payout-rail/dual-rail";
import { sanitizeProviderFailureText } from "@/lib/payments/payout-rail/outbound-display";
import { planCombineMinimumGroups } from "@/lib/payments/payout-rail/combine-minimum";

const RELEASE_ERROR_CODES = new Set([
  "GP_AWAITING_MINIMUM",
  "GP_AWAITING_FA_FUNDS",
  "GP_AWAITING_MINIMUM_COMBINE",
  "GP_RETURNED_MANUAL_REVIEW",
  "GP_PAYMENT_IN_FLIGHT",
  "GP_PAYMENT_OUTCOME_UNCERTAIN",
  "GP_QUOTE_EXPIRED",
  "GP_QUOTE_MISMATCH",
  "GP_QUOTE_FAILED",
  "GP_DESTINATION_CURRENCY_UNRESOLVED",
  "GP_FAILED_ATTEMPT_PRESERVED",
  "GP_PAYOUT_METHOD_UNREADABLE",
  "GP_FINANCIAL_ACCOUNT_UNREADABLE",
  "GP_QUOTE_COUNTRY_UNRESOLVED",
  "GP_QUOTE_POLICY_UNSUPPORTED",
  "GP_OUTBOUND_CREATE_FAILED",
  "GP_RECONCILIATION_INCOMPLETE",
  "GP_PAYMENT_ALREADY_EXISTS",
  "GP_RETRY_IN_PROGRESS",
  "GP_RETRY_NOT_AVAILABLE",
  "GP_QUOTE_REVIEW_REQUIRED",
  "GP_QUOTE_ACTOR_MISMATCH",
  "GP_UNDER_REVIEW",
  "GP_PILOT_ACTOR_UNAUTHORIZED",
  "GP_PILOT_USER_NOT_ALLOWLISTED",
  "GP_PILOT_COUNTRY_NOT_ALLOWLISTED",
  "GP_PILOT_SOURCE_CURRENCY_INVALID",
  "GP_PILOT_AMOUNT_CAP_INVALID",
  "GP_PILOT_AMOUNT_CAP_EXCEEDED",
  "GP_PILOT_TRANSACTION_NOT_AUTHORIZED",
  "GP_PILOT_FEE_CURRENCY_UNRESOLVED",
  "GP_PILOT_FUNDING_UNVERIFIED",
  "GP_PILOT_FUNDING_SHORT",
  "GP_PILOT_DESTINATION_MINIMUM",
  "GP_PILOT_DESTINATION_MINIMUMS_INVALID",
  "GP_PILOT_PAYMENT_ALREADY_STARTED",
]);

/** Stripe codes stay on the attempt row. The thrown code must not fall through to a second write. */
function stableReleaseErrorCode(code: string): string {
  return RELEASE_ERROR_CODES.has(code) ? code : "GP_OUTBOUND_CREATE_FAILED";
}

function countryMinimumBlocks(errMsg: string): boolean {
  const m = errMsg.toLowerCase();
  return m.includes("minimum") || m.includes("below_minimum") || m.includes("amount_too_small");
}

export async function releaseProcurementViaGlobalPayouts(opts: {
  protectedTxnId: string;
  actorUserId?: string | null;
}) {
  if (!isPaymentsEnabled() || !isStripeConfigured()) {
    throw Object.assign(new Error("Payments not configured"), {
      status: 503,
      code: "STRIPE_NOT_CONFIGURED",
    });
  }

  const txn = await prisma.protectedTransaction.findUnique({
    where: { id: opts.protectedTxnId },
  });
  if (!txn) {
    throw Object.assign(new Error("Transaction not found"), { status: 404 });
  }
  assertStripeModeCompatible(txn.stripeMode);
  const txnMode = normalizeStripeMode(txn.stripeMode);

  if (lockedPayoutRailFromTxn(txn) !== "STRIPE_GLOBAL_PAYOUTS") {
    throw Object.assign(new Error("Transaction is not locked to Global Payouts"), {
      status: 409,
      code: "PAYOUT_RAIL_MISMATCH",
    });
  }

  if (isDirectPaymentOption(txn.paymentOption)) {
    throw Object.assign(
      new Error("Procurement release is not available for Direct Payment"),
      { status: 409, code: "DIRECT_NO_PROCUREMENT" },
    );
  }

  if (!txn.procurementAdvanceAgreed || txn.procurementAdvanceMinor <= 0) {
    throw Object.assign(new Error("No procurement advance on this transaction"), {
      status: 400,
      code: "NO_PROCUREMENT",
    });
  }
  if (
    txn.refundedMinor > 0 ||
    ["REFUNDED", "PARTIALLY_REFUNDED", "CANCELLED", "DISPUTED", "RELEASED"].includes(
      txn.status,
    )
  ) {
    throw Object.assign(
      new Error(`Cannot release procurement from status ${txn.status}`),
      { status: 409, code: "INVALID_STATUS" },
    );
  }
  if (txn.procurementTransferredMinor >= txn.procurementAdvanceMinor) {
    return { alreadyReleased: true, txn, transferId: "" as const };
  }

  const status = txn.status as ProtectedStatus;
  if (!canTransition(status, "RELEASE_PROCUREMENT")) {
    throw Object.assign(
      new Error(`Cannot release procurement from status ${status}`),
      { status: 409, code: "INVALID_TRANSITION" },
    );
  }

  await assertNoConnectTransferSucceeded(txn.id, "PROCUREMENT");
  if (await hasGpSucceeded(txn.id, "PROCUREMENT")) {
    return { alreadyReleased: true, txn, transferId: "" };
  }

  if (!txn.sellerGpRecipientId || !txn.sellerGpPayoutMethodId) {
    throw Object.assign(new Error("Global Payouts destination not locked on transaction"), {
      status: 409,
      code: "GP_NOT_READY",
    });
  }

  const books = computeProtectedFinancials(txn);
  const amount = books.procurementAdvanceMinor - books.procurementTransferredMinor;
  if (amount <= 0) return { alreadyReleased: true, txn, transferId: "" };
  if (amount > books.itemCostMinor) {
    throw Object.assign(
      new Error("Procurement advance cannot include shipping or fees"),
      { status: 409, code: "PROCUREMENT_NOT_ITEM_ONLY" },
    );
  }
  assertProcurementReleaseInvariants({
    sellerEntitledMinor: books.sellerEntitledMinor,
    procurementAdvanceMinor: books.procurementAdvanceMinor,
    procurementTransferredMinor: books.procurementTransferredMinor,
    finalTransferredMinor: books.finalTransferredMinor,
    nextProcurementDelta: amount,
  });

  return executeOutboundRelease({
    txn,
    txnMode,
    status,
    kind: "PROCUREMENT",
    domainAction: "RELEASE_PROCUREMENT",
    amount,
    idempotencyKey: `proc_gp_${txn.id}_${txn.termsHash}`,
    actorUserId: opts.actorUserId,
    isFullResidual: true,
  });
}

export async function releaseFinalViaGlobalPayouts(opts: {
  protectedTxnId: string;
  actorUserId?: string | null;
  action?: Extract<DomainAction, "RELEASE_FINAL">;
  amountMinor?: number;
}) {
  if (!isPaymentsEnabled() || !isStripeConfigured()) {
    throw Object.assign(new Error("Payments not configured"), {
      status: 503,
      code: "STRIPE_NOT_CONFIGURED",
    });
  }

  const txn = await prisma.protectedTransaction.findUnique({
    where: { id: opts.protectedTxnId },
  });
  if (!txn) {
    throw Object.assign(new Error("Transaction not found"), { status: 404 });
  }
  assertStripeModeCompatible(txn.stripeMode);
  const txnMode = normalizeStripeMode(txn.stripeMode);
  const action = opts.action || "RELEASE_FINAL";

  if (lockedPayoutRailFromTxn(txn) !== "STRIPE_GLOBAL_PAYOUTS") {
    throw Object.assign(new Error("Transaction is not locked to Global Payouts"), {
      status: 409,
      code: "PAYOUT_RAIL_MISMATCH",
    });
  }

  if (isDirectPaymentOption(txn.paymentOption)) {
    throw Object.assign(
      new Error("Final release transfer is not used for Direct Payment"),
      { status: 409, code: "DIRECT_NO_PLATFORM_TRANSFER" },
    );
  }

  const status = txn.status as ProtectedStatus;
  if (!canTransition(status, action)) {
    throw Object.assign(
      new Error(`Cannot release final from status ${status}`),
      { status: 409, code: "INVALID_TRANSITION" },
    );
  }

  await assertNoConnectTransferSucceeded(txn.id, "FINAL");

  if (await hasGpSucceeded(txn.id, "FINAL")) {
    const full = await prisma.protectedTransaction.findUniqueOrThrow({
      where: { id: txn.id },
    });
    return {
      alreadyReleased: true,
      txn: full,
      amountMinor: 0,
      transferId: "",
    };
  }

  if (!txn.sellerGpRecipientId || !txn.sellerGpPayoutMethodId) {
    throw Object.assign(new Error("Global Payouts destination not locked on transaction"), {
      status: 409,
      code: "GP_NOT_READY",
    });
  }

  const books = computeProtectedFinancials(txn);
  const residual = books.finalResidualMinor;
  let amount = residual;
  let isFullResidual = true;
  if (opts.amountMinor != null) {
    const requested = Math.max(0, Math.floor(opts.amountMinor));
    if (requested <= 0) {
      return { alreadyReleased: true, txn, amountMinor: 0, transferId: "" };
    }
    if (requested > residual) {
      throw Object.assign(
        new Error(
          `Sourcer release cannot exceed remaining entitlement (${residual} minor units)`,
        ),
        {
          status: 409,
          code: "RELEASE_EXCEEDS_RESIDUAL",
          finalResidualMinor: residual,
        },
      );
    }
    amount = requested;
    isFullResidual = requested >= residual;
  }
  if (amount <= 0) {
    const next = nextStatus(status, action);
    const updated = await prisma.protectedTransaction.update({
      where: { id: txn.id },
      data: { status: next, releasedAt: new Date() },
    });
    await markListingSoldIfLinked(txn.listingId);
    return { alreadyReleased: true, txn: updated, amountMinor: 0, transferId: "" };
  }

  assertFinalReleaseInvariants({
    sellerEntitledMinor: books.sellerEntitledMinor,
    procurementTransferredMinor: books.procurementTransferredMinor,
    finalTransferredMinor: books.finalTransferredMinor,
    nextFinalDelta: amount,
  });

  const idempotencyKey = isFullResidual
    ? `final_gp_${txn.id}_${txn.termsHash}`
    : `final_gp_${txn.id}_${txn.termsHash}_admin_${amount}`;

  return executeOutboundRelease({
    txn,
    txnMode,
    status,
    kind: "FINAL",
    domainAction: action,
    amount,
    idempotencyKey,
    actorUserId: opts.actorUserId,
    isFullResidual,
  });
}

function livePilotEnv() {
  return {
    userAllowlistRaw: process.env.GLOBAL_PAYOUTS_USER_ALLOWLIST || "",
    configuredSourceCurrencyRaw: process.env.GLOBAL_PAYOUTS_LIVE_PILOT_SOURCE_CURRENCY || "",
    amountCapRaw: process.env.GLOBAL_PAYOUTS_LIVE_PILOT_AMOUNT_CAP_MINOR || "",
    authorizedTransactionIdRaw: process.env.GLOBAL_PAYOUTS_LIVE_PILOT_TRANSACTION_ID || "",
    destinationMinimumsRaw: process.env.GLOBAL_PAYOUTS_LIVE_DESTINATION_MINIMUMS || "",
  };
}

function coverForRelease(amount: number, currency: string, snapshot: QuoteSnapshot | null) {
  return quotedPayoutCover({
    principalMinor: amount,
    sourceCurrency: currency,
    providerFeeMinor: snapshot?.providerFeeMinor ?? 0,
    crossBorderFeeMinor: snapshot?.crossBorderFeeMinor ?? 0,
    fxFeeMinor: snapshot?.fxFeeMinor ?? 0,
    providerFeeCurrency: snapshot?.providerFeeCurrency || "",
    crossBorderFeeCurrency: snapshot?.crossBorderFeeCurrency || "",
    fxFeeCurrency: snapshot?.fxFeeCurrency || "",
  });
}

async function assertLivePilotReleaseReady(opts: {
  txn: { id: string; sellerId: string; buyerId: string; currency: string };
  txnMode: "TEST" | "LIVE";
  actorUserId?: string | null;
  amount: number;
  snapshotRaw: string;
  nowMs: number;
  recipientId: string;
  payoutMethodId: string;
  termsHash: string;
}) {
  if (opts.txnMode === "TEST") {
    // Buyer release, or the recorded inspection window, is the TEST authorization.
    // executeQuotedPayout creates, validates, stores, and attaches the quote.
    const snap = parseQuoteSnapshot(opts.snapshotRaw);
    const balance = await readFinancialAccountBalance("TEST");
    const decision = evaluateSandboxReleaseLimits({
      buyerId: opts.txn.buyerId,
      sellerId: opts.txn.sellerId,
      sourceCurrency: opts.txn.currency,
      principalMinor: opts.amount,
      providerFeeMinor: snap?.providerFeeMinor ?? 0,
      crossBorderFeeMinor: snap?.crossBorderFeeMinor ?? 0,
      fxFeeMinor: snap?.fxFeeMinor ?? 0,
      providerFeeCurrency: snap?.providerFeeCurrency || "",
      crossBorderFeeCurrency: snap?.crossBorderFeeCurrency || "",
      fxFeeCurrency: snap?.fxFeeCurrency || "",
      availableBalanceMinor: balance.availableMinor,
      checkFunding: true,
    });
    if (!decision.ok) {
      throw Object.assign(new Error("Sandbox payout limits denied this release."), {
        status: 409,
        code: decision.code,
      });
    }
    return;
  }
  if (opts.txnMode !== "LIVE") return;
  const snap = parseQuoteSnapshot(opts.snapshotRaw);
  const confirmed = evaluateQuoteConfirmation({
    stored: snap,
    actorUserId: opts.actorUserId || "",
    transactionId: opts.txn.id,
    mode: "LIVE",
    recipientId: opts.recipientId,
    payoutMethodId: opts.payoutMethodId,
    sourceAmountMinor: opts.amount,
    sourceCurrency: opts.txn.currency,
    destinationCurrency: snap?.destinationCurrency || "",
    termsHash: opts.termsHash,
    nowMs: opts.nowMs,
  });
  if (!confirmed.ok) {
    throw Object.assign(new Error("Review and confirm the payout estimate before release."), {
      status: 409,
      code: confirmed.code,
    });
  }
  const seller = await prisma.user.findUnique({
    where: { id: opts.txn.sellerId },
    select: { email: true, country: true },
  });
  const balance = await readFinancialAccountBalance("LIVE");
  const env = livePilotEnv();
  const decision = evaluateLivePilotInitiation({
    mode: "LIVE",
    gpEnabled: isGlobalPayoutsEnabled(),
    userAllowlistRaw: env.userAllowlistRaw,
    userId: opts.txn.sellerId,
    email: seller?.email ?? null,
    countryAllowed: isGlobalPayoutsCountryAllowed(seller?.country || ""),
    actorUserId: opts.actorUserId || "",
    buyerId: opts.txn.buyerId,
    sourceCurrency: opts.txn.currency,
    configuredSourceCurrencyRaw: env.configuredSourceCurrencyRaw,
    amountCapRaw: env.amountCapRaw,
    principalMinor: opts.amount,
    providerFeeMinor: snap?.providerFeeMinor ?? 0,
    crossBorderFeeMinor: snap?.crossBorderFeeMinor ?? 0,
    fxFeeMinor: snap?.fxFeeMinor ?? 0,
    providerFeeCurrency: snap?.providerFeeCurrency || "",
    crossBorderFeeCurrency: snap?.crossBorderFeeCurrency || "",
    fxFeeCurrency: snap?.fxFeeCurrency || "",
    availableBalanceMinor: balance.availableMinor,
    destinationAmountMinor: snap?.destinationAmountMinor ?? null,
    destinationCurrency: snap?.destinationCurrency || "",
    destinationQuoted: true,
    destinationMinimumsRaw: env.destinationMinimumsRaw,
    authorizedTransactionIdRaw: env.authorizedTransactionIdRaw,
    transactionId: opts.txn.id,
  });
  if (!decision.ok) {
    throw Object.assign(new Error("Live payout pilot limits denied this release."), {
      status: 409,
      code: decision.code,
    });
  }
}

async function claimLivePilotSlot(opts: {
  transactionId: string;
  attemptId: string;
}) {
  const authorized = (process.env.GLOBAL_PAYOUTS_LIVE_PILOT_TRANSACTION_ID || "").trim();
  // The lock, the occupancy read, and the durable claim share this interactive
  // transaction, so they use one connection. The lock ends at commit; the claim remains.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BigInt(LIVE_PILOT_LOCK_KEY)})`;
    const rows = await tx.outboundPaymentAttempt.findMany({
      where: { stripeMode: "LIVE" },
      select: {
        id: true,
        protectedTxnId: true,
        stripeOutboundPaymentId: true,
        status: true,
        failureCode: true,
        initiatedAt: true,
      },
    });
    const decision = evaluatePilotOccupancy({
      authorizedTransactionId: authorized,
      requestedTransactionId: opts.transactionId,
      claimingAttemptId: opts.attemptId,
      attempts: rows.map((row) => ({
        id: row.id,
        transactionId: row.protectedTxnId,
        outboundPaymentId: row.stripeOutboundPaymentId,
        status: row.status,
        failureCode: row.failureCode,
        initiatedAt: row.initiatedAt ? row.initiatedAt.toISOString() : null,
      })),
    });
    if (!decision.ok) {
      throw Object.assign(new Error("Another live pilot payout is already in progress."), {
        status: 409,
        code: decision.code,
      });
    }
    const claimed = await tx.outboundPaymentAttempt.updateMany({
      where: {
        id: opts.attemptId,
        stripeMode: "LIVE",
        stripeOutboundPaymentId: "",
        initiatedAt: null,
        failureCode: "",
        status: "PENDING",
      },
      data: { failureCode: "GP_PILOT_SLOT" },
    });
    if (claimed.count !== 1) {
      throw Object.assign(new Error("Another live pilot payout is already in progress."), {
        status: 409,
        code: "GP_PILOT_PAYMENT_ALREADY_STARTED",
      });
    }
  });
}

async function executeOutboundRelease(opts: {
  txn: {
    id: string;
    sellerId: string;
    buyerId: string;
    currency: string;
    termsHash: string;
    listingId: string | null;
    procurementTransferredMinor: number;
    finalTransferredMinor: number;
    sellerGpRecipientId: string;
    sellerGpPayoutMethodId: string;
    stripeMode: string;
  };
  txnMode: "TEST" | "LIVE";
  status: ProtectedStatus;
  kind: "PROCUREMENT" | "FINAL";
  domainAction: DomainAction;
  amount: number;
  idempotencyKey: string;
  actorUserId?: string | null;
  isFullResidual: boolean;
}) {
  const { txn, txnMode, amount, idempotencyKey, kind } = opts;

  const existingAttempt = await prisma.outboundPaymentAttempt.findUnique({
    where: { idempotencyKey },
  });
  if (
    existingAttempt?.status === "SUCCEEDED" ||
    existingAttempt?.status === "RECONCILED"
  ) {
    const full = await prisma.protectedTransaction.findUniqueOrThrow({
      where: { id: txn.id },
    });
    return {
      alreadyReleased: true,
      txn: full,
      amountMinor: amount,
      transferId: existingAttempt.stripeOutboundPaymentId || "",
      outboundPaymentId: existingAttempt.stripeOutboundPaymentId || "",
    };
  }
  // RETURNED: never auto-repay — admin must clear / re-key after review.
  if (existingAttempt?.status === "RETURNED") {
    throw Object.assign(
      new Error(
        "Prior outbound payment was returned. Automatic repayment is blocked — contact support / admin review.",
      ),
      {
        status: 409,
        code: "GP_RETURNED_MANUAL_REVIEW",
        needsAdminReview: true,
        attemptId: existingAttempt.id,
      },
    );
  }
  if (existingAttempt) {
    const preserved = assessAttemptPreservation({
      status: existingAttempt.status,
      failureCode: existingAttempt.failureCode,
      failureMessage: existingAttempt.failureMessage,
      fxRateSnapshot: existingAttempt.fxRateSnapshot,
      stripeOutboundPaymentId: existingAttempt.stripeOutboundPaymentId,
      initiatedAt: existingAttempt.initiatedAt,
      baseIdempotencyKey: idempotencyKey,
      nowMs: Date.now(),
    });
    if (preserved.preserve && existingAttempt.status !== "SUCCEEDED" && existingAttempt.status !== "RECONCILED") {
      throw Object.assign(
        new Error("Prior Global Payouts attempt is preserved. It was not retried."),
        {
          status: 409,
          code: preserved.code,
          nextIdempotencyKey: preserved.nextIdempotencyKey,
          attemptId: existingAttempt.id,
        },
      );
    }
  }
  if (
    existingAttempt?.status === "PROCESSING" &&
    existingAttempt.stripeOutboundPaymentId
  ) {
    // Unknown result — do not create a second payment; reconcile later via events.
    throw Object.assign(
      new Error("Outbound payment already in progress — awaiting provider confirmation"),
      {
        status: 409,
        code: "GP_PAYMENT_IN_FLIGHT",
        pendingProvider: true,
        outboundPaymentId: existingAttempt.stripeOutboundPaymentId,
      },
    );
  }

  let attempt =
    existingAttempt ||
    (await prisma.outboundPaymentAttempt.create({
      data: {
        protectedTxnId: txn.id,
        kind,
        amountMinor: amount,
        currency: txn.currency,
        stripeMode: txnMode,
        idempotencyKey,
        status: "PENDING",
        stripeRecipientId: txn.sellerGpRecipientId,
        stripePayoutMethodId: txn.sellerGpPayoutMethodId,
      },
    }));

  if (
    existingAttempt &&
    (existingAttempt.stripeOutboundPaymentId ||
      existingAttempt.initiatedAt ||
      pilotFailureIsSticky(existingAttempt.failureCode))
  ) {
    throw Object.assign(
      new Error("Outbound payment outcome is still uncertain. Automatic retry is blocked."),
      {
        status: 409,
        code: "GP_PAYMENT_IN_FLIGHT",
        pendingProvider: true,
        outboundPaymentId: existingAttempt.stripeOutboundPaymentId || "",
      },
    );
  }

  if (
    existingAttempt &&
    ["FAILED", "AWAITING_MINIMUM", "AWAITING_FA_FUNDS", "ACTION_REQUIRED"].includes(
      existingAttempt.status,
    )
  ) {
    // AWAITING_MINIMUM: only auto-retry when combine plan says group is still
    // single-row (true multi-row combine remains admin-assisted — see combine-minimum).
    if (existingAttempt.status === "AWAITING_MINIMUM") {
      const siblings = await prisma.outboundPaymentAttempt.findMany({
        where: {
          status: "AWAITING_MINIMUM",
          currency: existingAttempt.currency,
          stripeMode: existingAttempt.stripeMode,
          stripeRecipientId: existingAttempt.stripeRecipientId,
        },
        select: {
          id: true,
          amountMinor: true,
          currency: true,
          stripeMode: true,
          status: true,
          protectedTxnId: true,
        },
      });
      const groups = planCombineMinimumGroups(
        siblings.map((s) => ({
          attemptId: s.id,
          sellerId: txn.sellerId,
          currency: s.currency,
          amountMinor: s.amountMinor,
          stripeMode: s.stripeMode,
          status: s.status,
        })),
      );
      const ownGroup = groups.find((g) =>
        g.some((r) => r.attemptId === existingAttempt.id),
      );
      if (ownGroup && ownGroup.length > 1) {
        throw Object.assign(
          new Error(
            "Payout is below local minimum and grouped with other entitlements. Admin combine/retry required.",
          ),
          {
            status: 409,
            code: "GP_AWAITING_MINIMUM_COMBINE",
            needsAdminReview: true,
            combineGroupSize: ownGroup.length,
          },
        );
      }
    }
    attempt = await prisma.outboundPaymentAttempt.update({
      where: { id: existingAttempt.id },
      data: {
        status: "PENDING",
        lastAttemptAt: new Date(),
        failureCode: "",
        failureMessage: "",
        initiatedAt: null,
      },
    });
  }

  const releaseCover = coverForRelease(
    amount,
    txn.currency,
    parseQuoteSnapshot(attempt.fxRateSnapshot),
  );
  if (!releaseCover.ok) {
    await prisma.outboundPaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "FAILED",
        failureCode: releaseCover.code,
        failureMessage: "Payout fees cannot be reserved in the source currency.",
        lastAttemptAt: new Date(),
      },
    });
    throw Object.assign(new Error("Payout fees cannot be reserved in the source currency."), {
      status: 409,
      code: releaseCover.code,
    });
  }
  const funding = await ensureFinancialAccountFunding({
    mode: txnMode,
    amountMinor: releaseCover.requiredCoverMinor,
    currency: txn.currency,
    idempotencyKey: `fa_fund_${attempt.id}`,
    protectedTxnId: txn.id,
  });

  if (funding.status === "error") {
    await prisma.outboundPaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "FAILED",
        failureCode: funding.code,
        failureMessage: funding.message.slice(0, 500),
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });
    throw Object.assign(new Error(funding.message), {
      status: 503,
      code: funding.code,
    });
  }

  if (funding.status === "awaiting_funds") {
    await prisma.outboundPaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "AWAITING_FA_FUNDS",
        stripeFinancialAccountId: funding.financialAccountId,
        failureMessage: funding.reason.slice(0, 500),
        lastAttemptAt: new Date(),
      },
    });
    // Preserve entitlement — do not advance domain transferred counters.
    throw Object.assign(
      new Error(
        "Payout is authorized but awaiting Financial Account funds. Entitlement preserved.",
      ),
      { status: 409, code: "GP_AWAITING_FA_FUNDS" },
    );
  }

  if (!canInitiateGlobalPayoutsMoney(txnMode)) {
    await prisma.outboundPaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "AWAITING_FA_FUNDS",
        stripeFinancialAccountId: funding.financialAccountId,
        failureCode: "GP_INITIATION_DISABLED",
        failureMessage: "Live/sandbox GP initiation disabled — entitlement preserved",
        lastAttemptAt: new Date(),
      },
    });
    throw Object.assign(
      new Error("Global Payouts initiation is disabled. Entitlement preserved."),
      { status: 503, code: "GLOBAL_PAYOUTS_INITIATION_DISABLED" },
    );
  }

  if (txnMode === "LIVE" || txnMode === "TEST") {
    await assertLivePilotReleaseReady({
      txn,
      txnMode,
      actorUserId: opts.actorUserId,
      amount,
      snapshotRaw: attempt.fxRateSnapshot,
      nowMs: Date.now(),
      recipientId: txn.sellerGpRecipientId,
      payoutMethodId: txn.sellerGpPayoutMethodId,
      termsHash: txn.termsHash,
    });
    if (txnMode === "LIVE") {
      await claimLivePilotSlot({ transactionId: txn.id, attemptId: attempt.id });
    }
  }

  const faId =
    funding.financialAccountId ||
    getGlobalPayoutsFinancialAccountId(txnMode);

  const stripeIdempotencyKey =
    attempt.attemptCount > 1
      ? `${idempotencyKey}_a${attempt.attemptCount}`
      : idempotencyKey;

  let capturedOutboundId = "";
  let submissionMarked = false;

  try {
    const methodRes = await gpFetch({
      mode: txnMode,
      method: "GET",
      path: `/v2/money_management/payout_methods/${encodeURIComponent(txn.sellerGpPayoutMethodId)}`,
      stripeContext: txn.sellerGpRecipientId,
    });
    if (!methodRes.ok) {
      const parsed = parseGpProviderError(methodRes);
      await prisma.outboundPaymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "FAILED",
          failureCode: (parsed.code || "GP_PAYOUT_METHOD_UNREADABLE").slice(0, 80),
          failureMessage: parsed.message.slice(0, 500),
          reconciliationNote: mergeAttemptNote(attempt.reconciliationNote, providerErrorRecord(parsed)),
          lastAttemptAt: new Date(),
          attemptCount: { increment: 1 },
        },
      });
      // A payout-method read does not create money. Keep it retryable.
      throw Object.assign(new Error(parsed.message), {
        status: methodRes.status >= 500 ? 503 : 502,
        code: "GP_PAYOUT_METHOD_UNREADABLE",
      });
    }
    const mapped = await prisma.globalPayoutRecipient.findFirst({
      where: { stripeRecipientId: txn.sellerGpRecipientId, stripeMode: txnMode },
      select: { defaultCurrency: true },
    });
    const destination = resolveDestinationCurrency({
      supportedCurrencies: payoutMethodCurrencies(methodRes.body),
      mappedCurrency: mapped?.defaultCurrency,
    });
    if (!destination.ok) {
      await prisma.outboundPaymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "FAILED",
          failureCode: destination.code,
          failureMessage: "Payout method destination currency is not available.",
          lastAttemptAt: new Date(),
          attemptCount: { increment: 1 },
        },
      });
      throw Object.assign(new Error("Payout method destination currency is not available."), {
        status: 409,
        code: destination.code,
      });
    }

    const faRes = faId
      ? await gpFetch({
          mode: txnMode,
          method: "GET",
          path: `/v2/money_management/financial_accounts/${encodeURIComponent(faId)}`,
        })
      : { ok: false as const, status: 0, body: {}, requestId: null };
    const route = evaluateQuoteRoute({
      methodReadOk: true,
      financialAccountReadOk: Boolean(faRes.ok),
      financialAccountCountry: faRes.ok ? financialAccountCountry(faRes.body) : "",
      payoutMethodCountry: payoutMethodCountry(methodRes.body),
    });
    if (!route.ok) {
      const parsed = faRes.ok ? null : parseGpProviderError(faRes);
      await prisma.outboundPaymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "FAILED",
          failureCode: route.code,
          failureMessage: (parsed?.message || "Quote route could not be verified.").slice(0, 500),
          reconciliationNote: parsed
            ? mergeAttemptNote(attempt.reconciliationNote, providerErrorRecord(parsed))
            : attempt.reconciliationNote,
          lastAttemptAt: new Date(),
          attemptCount: { increment: 1 },
        },
      });
      throw Object.assign(new Error("Quote route could not be verified."), {
        status: 409,
        code: route.code,
      });
    }

    const payout = await executeQuotedPayout({
      sourceAmountMinor: amount,
      sourceCurrency: txn.currency,
      destinationCurrency: destination.currency,
      financialAccountId: faId,
      recipientId: txn.sellerGpRecipientId,
      payoutMethodId: txn.sellerGpPayoutMethodId,
      paymentIdempotencyKey: stripeIdempotencyKey,
      metadata: {
        protectedTxnId: txn.id,
        kind,
        rail: "STRIPE_GLOBAL_PAYOUTS",
        termsHash: txn.termsHash,
      },
      mode: txnMode,
      nowMs: Date.now(),
      requiresQuote: route.requiresQuote,
      storedSnapshot: attempt.fxRateSnapshot,
      actorUserId: opts.actorUserId,
      assertBeforeProviderWrite: async (snapshot) => {
        const cover = coverForRelease(amount, txn.currency, snapshot);
        if (!cover.ok) {
          throw Object.assign(new Error("Payout fees cannot be reserved in the source currency."), {
            status: 409,
            code: cover.code,
          });
        }
        const balance = await readFinancialAccountBalance(txnMode);
        if (balance.availableMinor != null && balance.availableMinor < cover.requiredCoverMinor) {
          throw Object.assign(
            new Error("Financial account balance does not cover the payout and its separate provider fees."),
            { status: 409, code: "GP_PILOT_FUNDING_SHORT" },
          );
        }
        if (txnMode === "TEST" || txnMode === "LIVE") {
          await assertLivePilotReleaseReady({
            txn,
            txnMode,
            actorUserId: opts.actorUserId,
            amount,
            snapshotRaw: snapshot ? JSON.stringify(snapshot) : attempt.fxRateSnapshot,
            nowMs: Date.now(),
            recipientId: txn.sellerGpRecipientId,
            payoutMethodId: txn.sellerGpPayoutMethodId,
            termsHash: txn.termsHash,
          });
        }
      },
      post: async (req) =>
        gpFetch({
          mode: txnMode,
          method: "POST",
          path: req.path,
          moneyMutation: true,
          idempotencyKey: req.idempotencyKey,
          body: req.body,
        }),
      persistQuote: async (snapshot: QuoteSnapshot) => {
        const stored = await prisma.outboundPaymentAttempt.updateMany({
          where: {
            id: attempt.id,
            fxRateSnapshot: attempt.fxRateSnapshot || "",
            initiatedAt: null,
            stripeOutboundPaymentId: "",
          },
          data: {
            stripeFinancialAccountId: faId,
            destinationCurrency: snapshot.destinationCurrency.toUpperCase(),
            destinationAmountMinor: snapshot.destinationAmountMinor,
            providerFeeMinor: snapshot.providerFeeMinor,
            crossBorderFeeMinor: snapshot.crossBorderFeeMinor,
            fxFeeMinor: snapshot.fxFeeMinor,
            fxRateSnapshot: JSON.stringify(snapshot),
          },
        });
        if (stored.count !== 1) {
          throw Object.assign(
            new Error("Outbound payment outcome is still uncertain. Automatic retry is blocked."),
            { status: 409, code: "GP_PAYMENT_IN_FLIGHT", pendingProvider: true },
          );
        }
      },
      markPaymentSubmission: async () => {
        const claimed = await prisma.outboundPaymentAttempt.updateMany({
          where: {
            id: attempt.id,
            initiatedAt: null,
            stripeOutboundPaymentId: "",
          },
          data: { initiatedAt: new Date(), stripeFinancialAccountId: faId },
        });
        if (claimed.count !== 1) {
          throw Object.assign(
            new Error("Outbound payment outcome is still uncertain. Automatic retry is blocked."),
            { status: 409, code: "GP_PAYMENT_IN_FLIGHT", pendingProvider: true },
          );
        }
        submissionMarked = true;
      },
    });

    if (!payout.ok) {
      const message = sanitizeProviderFailureText(payout.parsed?.message || payout.code);
      const holdUncertainSlot = payout.uncertain || submissionMarked;
      if (!payout.uncertain && !submissionMarked && countryMinimumBlocks(message)) {
        await prisma.outboundPaymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: "AWAITING_MINIMUM",
            failureCode: "BELOW_MINIMUM",
            failureMessage: message.slice(0, 500),
            reconciliationNote: payout.parsed
              ? mergeAttemptNote(attempt.reconciliationNote, providerErrorRecord(payout.parsed))
              : attempt.reconciliationNote,
            stripeFinancialAccountId: faId,
            attemptCount: { increment: 1 },
            lastAttemptAt: new Date(),
          },
        });
        throw Object.assign(
          new Error(
            "Payout is below the local minimum. Entitlement preserved until combined or topped.",
          ),
          { status: 409, code: "GP_AWAITING_MINIMUM" },
        );
      }
      await prisma.outboundPaymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "FAILED",
          failureCode: holdUncertainSlot
            ? "GP_PAYMENT_OUTCOME_UNCERTAIN"
            : payout.code.slice(0, 80),
          failureMessage: message.slice(0, 500),
          reconciliationNote: payout.parsed
            ? mergeAttemptNote(attempt.reconciliationNote, providerErrorRecord(payout.parsed))
            : attempt.reconciliationNote,
          lastAttemptAt: new Date(),
          attemptCount: { increment: 1 },
        },
      });
      throw Object.assign(new Error(message), {
        status: payout.uncertain ? 409 : 502,
        code: stableReleaseErrorCode(payout.code),
      });
    }

    const outboundId = typeof payout.body.id === "string" ? payout.body.id : "";
    capturedOutboundId = outboundId;
    const underReview = outboundPaymentIsUnderReview(payout.body);
    const providerStatus = mapOutboundPaymentProviderStatus(payout.body);
    // Never mark paid on submit alone — PROCESSING until posted/succeeded event.
    const localStatus =
      providerStatus === "SUCCEEDED" ? "SUCCEEDED" : "PROCESSING";

    await prisma.outboundPaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: localStatus === "SUCCEEDED" ? "PROCESSING" : "PROCESSING",
        // Always park on PROCESSING first; CAS finalize owns SUCCEEDED transition.
        stripeOutboundPaymentId: outboundId,
        stripeFinancialAccountId: faId,
        initiatedAt: new Date(),
        lastAttemptAt: new Date(),
        attemptCount: { increment: 1 },
        failureCode: underReview ? "GP_UNDER_REVIEW" : "",
        failureMessage: underReview
          ? "Held for provider review. Payment is not finalized."
          : "",
      },
    });

    if (underReview || localStatus !== "SUCCEEDED") {
      // Domain counters update only on SUCCEEDED (webhook or immediate posted).
      await recordAuditEvent({
        protectedTxnId: txn.id,
        actorUserId: opts.actorUserId,
        action:
          kind === "PROCUREMENT"
            ? "GP_OUTBOUND_INITIATED_PROCUREMENT"
            : "GP_OUTBOUND_INITIATED_FINAL",
        meta: {
          outboundPaymentId: outboundId,
          amountMinor: amount,
          attemptId: attempt.id,
        },
      });
      const fullPending = await prisma.protectedTransaction.findUniqueOrThrow({
        where: { id: txn.id },
      });
      return {
        alreadyReleased: false,
        pendingProvider: true,
        txn: fullPending,
        outboundPaymentId: outboundId,
        transferId: outboundId,
        amountMinor: amount,
      };
    }

    return finalizeOutboundSuccess({
      attemptId: attempt.id,
      outboundId,
      txn,
      status: opts.status,
      domainAction: opts.domainAction,
      kind,
      amount,
      idempotencyKey,
      actorUserId: opts.actorUserId,
      isFullResidual: opts.isFullResidual,
      providerBody: payout.body,
    });
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      RELEASE_ERROR_CODES.has(String((err as { code?: string }).code))
    ) {
      throw err;
    }
    // Stripe created the outbound but local DB / finalize failed — keep PROCESSING
    // with provider id so reconcile / webhook can finish (never mark FAILED + retry new OP).
    if (capturedOutboundId) {
      await prisma.outboundPaymentAttempt
        .update({
          where: { id: attempt.id },
          data: {
            status: "PROCESSING",
            stripeOutboundPaymentId: capturedOutboundId,
            stripeFinancialAccountId: faId,
            initiatedAt: new Date(),
            lastAttemptAt: new Date(),
            failureCode: "LOCAL_FINALIZE_PENDING",
            failureMessage: sanitizeProviderFailureText(
              err instanceof Error
                ? err.message
                : "Outbound created; local confirmation pending reconcile",
            ),
          },
        })
        .catch(() => null);
      throw Object.assign(
        new Error(
          "Outbound payment created at provider; local confirmation pending reconcile",
        ),
        {
          status: 409,
          code: "GP_PAYMENT_IN_FLIGHT",
          pendingProvider: true,
          outboundPaymentId: capturedOutboundId,
        },
      );
    }
    const message = sanitizeProviderFailureText(
      err instanceof Error ? err.message : "Outbound payment failed",
    );
    await prisma.outboundPaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "FAILED",
        ...(submissionMarked
          ? { failureCode: "GP_PAYMENT_OUTCOME_UNCERTAIN" }
          : {}),
        failureMessage: message.slice(0, 500),
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });
    throw err;
  }
}

function toRetryAttempt(row: {
  id: string;
  protectedTxnId: string;
  kind: string;
  idempotencyKey: string;
  status: string;
  failureCode: string;
  failureMessage: string;
  fxRateSnapshot: string;
  stripeOutboundPaymentId: string;
  initiatedAt: Date | null;
  reconciliationNote: string;
  updatedAt: Date;
  amountMinor: number;
  currency: string;
  stripeMode: string;
  stripeRecipientId: string;
  stripePayoutMethodId: string;
}): RetryAttemptRecord {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

function readListedPayments(body: Record<string, unknown>): ListedOutboundPayment[] | null {
  if (!Array.isArray(body.data)) return null;
  const payments: ListedOutboundPayment[] = [];
  for (const raw of body.data) {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    const amount =
      row.amount && typeof row.amount === "object"
        ? (row.amount as { value?: unknown; currency?: unknown })
        : {};
    const from =
      row.from && typeof row.from === "object"
        ? (row.from as { financial_account?: unknown })
        : {};
    const to =
      row.to && typeof row.to === "object"
        ? (row.to as { recipient?: unknown; payout_method?: unknown })
        : {};
    const metadata =
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as { protectedTxnId?: unknown })
        : {};
    payments.push({
      id: typeof row.id === "string" ? row.id : "",
      recipient: typeof to.recipient === "string" ? to.recipient : "",
      payoutMethod: typeof to.payout_method === "string" ? to.payout_method : "",
      financialAccount: typeof from.financial_account === "string" ? from.financial_account : "",
      amountMinor: typeof amount.value === "number" && Number.isInteger(amount.value) ? amount.value : null,
      currency: typeof amount.currency === "string" ? amount.currency : "",
      metadataTxnId: typeof metadata.protectedTxnId === "string" ? metadata.protectedTxnId : "",
    });
  }
  return payments;
}

async function reconcileNoMatchingOutbound(opts: {
  mode: "TEST" | "LIVE";
  protectedTxnId: string;
  recipientId: string;
  payoutMethodId: string;
  financialAccountId: string;
  amountMinor: number;
  currency: string;
}) {
  if (!opts.recipientId || !opts.payoutMethodId || !opts.financialAccountId || opts.amountMinor <= 0) {
    return { ok: false as const, code: "GP_RECONCILIATION_INCOMPLETE" as const };
  }
  let path = `/v2/money_management/outbound_payments?recipient=${encodeURIComponent(opts.recipientId)}&limit=100`;
  const payments: ListedOutboundPayment[] = [];
  for (let page = 0; page < 20; page += 1) {
    const listed = await gpFetch({ mode: opts.mode, method: "GET", path });
    if (!listed.ok) return { ok: false as const, code: "GP_RECONCILIATION_INCOMPLETE" as const };
    const batch = readListedPayments(listed.body);
    if (!batch) return { ok: false as const, code: "GP_RECONCILIATION_INCOMPLETE" as const };
    payments.push(...batch);
    const next = listed.body.next_page_url;
    if (!next) {
      return proveNoExistingOutboundPayment({ complete: true, payments, ...opts });
    }
    if (typeof next !== "string" || !next.startsWith("https://api.stripe.com/v2/money_management/outbound_payments")) {
      return { ok: false as const, code: "GP_RECONCILIATION_INCOMPLETE" as const };
    }
    path = next.slice("https://api.stripe.com".length);
  }
  return { ok: false as const, code: "GP_RECONCILIATION_INCOMPLETE" as const };
}

/**
 * Explicit corrected retry for a definitively rejected quote-required attempt.
 * Does not accept an idempotency key or a retry version from the caller.
 * Does not modify the original failed attempt.
 */
export async function retryDefinitiveQuoteRejection(opts: {
  protectedTxnId: string;
  actorUserId?: string | null;
}) {
  if (!isPaymentsEnabled() || !isStripeConfigured()) {
    throw Object.assign(new Error("Payments not configured"), {
      status: 503,
      code: "STRIPE_NOT_CONFIGURED",
    });
  }
  const txn = await prisma.protectedTransaction.findUnique({ where: { id: opts.protectedTxnId } });
  if (!txn) throw Object.assign(new Error("Transaction not found"), { status: 404 });
  assertStripeModeCompatible(txn.stripeMode);
  const txnMode = normalizeStripeMode(txn.stripeMode);
  if (lockedPayoutRailFromTxn(txn) !== "STRIPE_GLOBAL_PAYOUTS") {
    throw Object.assign(new Error("Transaction is not locked to Global Payouts"), {
      status: 409,
      code: "PAYOUT_RAIL_MISMATCH",
    });
  }
  if (isDirectPaymentOption(txn.paymentOption)) {
    throw Object.assign(new Error("Final release transfer is not used for Direct Payment"), {
      status: 409,
      code: "DIRECT_NO_PLATFORM_TRANSFER",
    });
  }
  if (!txn.sellerGpRecipientId || !txn.sellerGpPayoutMethodId) {
    throw Object.assign(new Error("Global Payouts destination not locked on transaction"), {
      status: 409,
      code: "GP_NOT_READY",
    });
  }

  const loadAttempts = async () => {
    const rows = await prisma.outboundPaymentAttempt.findMany({ where: { protectedTxnId: txn.id } });
    return rows.map(toRetryAttempt);
  };

  return runCorrectedQuoteRetry({
    protectedTxnId: txn.id,
    nowMs: Date.now(),
    loadAttempts,
    createAttempt: async (row) => {
      try {
        const created = await prisma.outboundPaymentAttempt.create({
          data: {
            ...row,
            status: "PENDING",
            failureCode: "",
            failureMessage: "",
            fxRateSnapshot: "",
            stripeOutboundPaymentId: "",
          },
        });
        return { ok: true, attempt: toRetryAttempt(created) };
      } catch (err) {
        if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002") {
          return { ok: false, code: "UNIQUE" };
        }
        throw err;
      }
    },
    claimAttempt: async (id, updatedAt) => {
      const claimed = await prisma.outboundPaymentAttempt.updateMany({
        where: {
          id,
          updatedAt: new Date(updatedAt),
          status: "PENDING",
          failureCode: "",
          initiatedAt: null,
          stripeOutboundPaymentId: "",
        },
        data: { failureCode: "GP_RETRY_CLAIMED", lastAttemptAt: new Date() },
      });
      return claimed.count === 1;
    },
    reconcile: async () => {
      const rows = await loadAttempts();
      const original = rows.find((row) => {
        const preserved = assessAttemptPreservation({
          status: row.status,
          failureCode: row.failureCode,
          failureMessage: row.failureMessage,
          fxRateSnapshot: row.fxRateSnapshot,
          stripeOutboundPaymentId: row.stripeOutboundPaymentId,
          initiatedAt: row.initiatedAt,
          baseIdempotencyKey: row.idempotencyKey,
          nowMs: Date.now(),
        });
        return preserved.preserve && preserved.code === "GP_FAILED_ATTEMPT_PRESERVED";
      });
      return reconcileNoMatchingOutbound({
        mode: txnMode,
        protectedTxnId: txn.id,
        recipientId: txn.sellerGpRecipientId,
        payoutMethodId: txn.sellerGpPayoutMethodId,
        financialAccountId: getGlobalPayoutsFinancialAccountId(txnMode),
        amountMinor: original?.amountMinor ?? 0,
        currency: original?.currency || txn.currency,
      });
    },
    execute: async (attempt) => {
      const kind = attempt.kind === "PROCUREMENT" ? "PROCUREMENT" : "FINAL";
      const action = kind === "PROCUREMENT" ? "RELEASE_PROCUREMENT" : "RELEASE_FINAL";
      const status = txn.status as ProtectedStatus;
      if (!canTransition(status, action)) {
        throw Object.assign(new Error(`Cannot release from status ${status}`), {
          status: 409,
          code: "INVALID_TRANSITION",
        });
      }
      await assertNoConnectTransferSucceeded(txn.id, kind);
      if (await hasGpSucceeded(txn.id, kind)) {
        throw Object.assign(new Error("Global Payouts release already succeeded"), {
          status: 409,
          code: "GP_PAYMENT_IN_FLIGHT",
        });
      }
      const books = computeProtectedFinancials(txn);
      if (kind === "FINAL" && attempt.amountMinor > books.finalResidualMinor) {
        throw Object.assign(new Error("Sourcer release cannot exceed remaining entitlement"), {
          status: 409,
          code: "RELEASE_EXCEEDS_RESIDUAL",
        });
      }
      const baseKey = kind === "PROCUREMENT"
        ? `proc_gp_${txn.id}_${txn.termsHash}`
        : `final_gp_${txn.id}_${txn.termsHash}`;
      await executeOutboundRelease({
        txn,
        txnMode,
        status,
        kind,
        domainAction: action,
        amount: attempt.amountMinor,
        idempotencyKey: attempt.idempotencyKey,
        actorUserId: opts.actorUserId,
        isFullResidual: attempt.idempotencyKey === correctedQuoteRetryKey(baseKey),
      });
    },
  });
}

export async function finalizeOutboundSuccess(opts: {
  attemptId: string;
  outboundId: string;
  txn: {
    id: string;
    listingId: string | null;
    procurementTransferredMinor: number;
    finalTransferredMinor: number;
    currency: string;
    conversationId?: string | null;
    buyerId?: string;
    sellerId?: string;
    title?: string | null;
    origin?: string | null;
  };
  status: ProtectedStatus;
  domainAction: DomainAction;
  kind: "PROCUREMENT" | "FINAL";
  amount: number;
  idempotencyKey: string;
  actorUserId?: string | null;
  isFullResidual: boolean;
  providerBody?: Record<string, unknown>;
}) {
  if (
    underReviewBlocksFinalization({
      providerUnderReview: outboundPaymentIsUnderReview(opts.providerBody),
    })
  ) {
    throw Object.assign(new Error("Outbound payment is under review and was not finalized."), {
      status: 409,
      code: "GP_UNDER_REVIEW",
    });
  }
  const { kind, amount, idempotencyKey } = opts;
  const next = nextStatus(opts.status, opts.domainAction);
  const feeMeta = extractProviderFees(opts.providerBody);

  type TxnRow = Awaited<
    ReturnType<typeof prisma.protectedTransaction.findUniqueOrThrow>
  >;

    const casResult = await prisma.$transaction(async (tx) => {
    const prior = await tx.outboundPaymentAttempt.findUnique({
      where: { id: opts.attemptId },
      select: {
        fxRateSnapshot: true,
        destinationCurrency: true,
        destinationAmountMinor: true,
        providerFeeMinor: true,
        crossBorderFeeMinor: true,
        fxFeeMinor: true,
      },
    });
    // Compare-and-swap: only one winner may advance PROCESSING/PENDING → SUCCEEDED.
    const cas = await tx.outboundPaymentAttempt.updateMany({
      where: {
        id: opts.attemptId,
        status: { in: ["PROCESSING", "PENDING", "ACTION_REQUIRED"] },
      },
      data: {
        status: "SUCCEEDED",
        stripeOutboundPaymentId: opts.outboundId,
        succeededAt: new Date(),
        postedAt: new Date(),
        lastAttemptAt: new Date(),
        failureCode: "",
        failureMessage: "",
        providerFeeMinor: feeMeta.feesPresent
          ? feeMeta.providerFeeMinor
          : prior?.providerFeeMinor ?? 0,
        crossBorderFeeMinor: feeMeta.feesPresent
          ? feeMeta.crossBorderFeeMinor
          : prior?.crossBorderFeeMinor ?? 0,
        fxFeeMinor: feeMeta.feesPresent ? feeMeta.fxFeeMinor : prior?.fxFeeMinor ?? 0,
        destinationCurrency:
          feeMeta.destinationCurrency || prior?.destinationCurrency || "",
        destinationAmountMinor:
          feeMeta.destinationAmountMinor || prior?.destinationAmountMinor || 0,
        fxRateSnapshot: mergeStoredQuoteSnapshot(
          prior?.fxRateSnapshot || "",
          feeMeta.fxRateSnapshot,
        ),
      },
    });

    if (cas.count !== 1) {
      const current = await tx.outboundPaymentAttempt.findUnique({
        where: { id: opts.attemptId },
      });
      if (
        current?.status === "SUCCEEDED" ||
        current?.status === "RECONCILED"
      ) {
        const existingTxn = await tx.protectedTransaction.findUniqueOrThrow({
          where: { id: opts.txn.id },
        });
        return {
          alreadyFinalized: true as const,
          updated: existingTxn,
        };
      }
      throw Object.assign(
        new Error(
          `Outbound finalize CAS conflict (status=${current?.status || "missing"})`,
        ),
        { status: 409, code: "GP_FINALIZE_CAS_CONFLICT" },
      );
    }

    // Re-read txn inside the transaction for counter integrity under concurrency.
    const freshTxn = await tx.protectedTransaction.findUniqueOrThrow({
      where: { id: opts.txn.id },
    });

    let updated: TxnRow;
    if (kind === "PROCUREMENT") {
      updated = await tx.protectedTransaction.update({
        where: { id: freshTxn.id },
        data: {
          status: next,
          procurementTransferredMinor:
            freshTxn.procurementTransferredMinor + amount,
          procurementReleasedAt: new Date(),
        },
      });
    } else {
      const finalStatus = opts.isFullResidual
        ? next
        : opts.status === "READY_TO_RELEASE"
          ? "PARTIALLY_REFUNDED"
          : opts.status;
      updated = await tx.protectedTransaction.update({
        where: { id: freshTxn.id },
        data: {
          status: finalStatus,
          finalTransferredMinor: freshTxn.finalTransferredMinor + amount,
          releasedAt: opts.isFullResidual ? new Date() : undefined,
        },
      });
    }

    return { alreadyFinalized: false as const, updated };
  });

  if (casResult.alreadyFinalized) {
    return {
      alreadyReleased: true,
      txn: casResult.updated,
      outboundPaymentId: opts.outboundId,
      transferId: opts.outboundId,
      amountMinor: amount,
      activityVersion: 0,
      linkedTicketId: null as string | null,
    };
  }

  const updated = casResult.updated;

  const { feesPresent: _feesPresent, ...feeRecord } = feeMeta;

  await appendLedgerEntry({
    protectedTxnId: updated.id,
    entryType:
      kind === "PROCUREMENT" ? "PROCUREMENT_TRANSFER" : "FINAL_TRANSFER",
    direction: "DEBIT",
    amountMinor: amount,
    currency: updated.currency,
    idempotencyKey: `ledger_${idempotencyKey}`,
    stripeObjectId: opts.outboundId,
    stripeObjectType: "outbound_payment",
    meta: {
      rail: "STRIPE_GLOBAL_PAYOUTS",
      providerFeesAbsorbedByPlatform: true,
      ...feeRecord,
    },
  });

  await recordAuditEvent({
    protectedTxnId: updated.id,
    actorUserId: opts.actorUserId,
    action: kind === "PROCUREMENT" ? "RELEASE_PROCUREMENT" : "RELEASE_FINAL",
    meta: {
      outboundPaymentId: opts.outboundId,
      amountMinor: amount,
      rail: "STRIPE_GLOBAL_PAYOUTS",
      providerFeesAbsorbedByPlatform: true,
    },
  });

  if (kind === "FINAL" && opts.isFullResidual) {
    await markListingSoldIfLinked(updated.listingId);
  }

  const participantSync = await afterProtectedTxnMoneyEvent({
    txn: updated,
    event: kind === "PROCUREMENT" ? "PROCUREMENT_RELEASED" : "FINAL_RELEASED",
    actorUserId: opts.actorUserId,
  });

  return {
    alreadyReleased: false,
    txn: updated,
    outboundPaymentId: opts.outboundId,
    transferId: opts.outboundId,
    amountMinor: amount,
    activityVersion: participantSync.activityVersion,
    linkedTicketId: participantSync.linkedTicketId,
  };
}

export function extractProviderFees(body?: Record<string, unknown>): {
  providerFeeMinor: number;
  crossBorderFeeMinor: number;
  fxFeeMinor: number;
  destinationCurrency: string;
  destinationAmountMinor: number;
  fxRateSnapshot: string;
  feesPresent: boolean;
} {
  const empty = {
    providerFeeMinor: 0,
    crossBorderFeeMinor: 0,
    fxFeeMinor: 0,
    destinationCurrency: "",
    destinationAmountMinor: 0,
    fxRateSnapshot: "",
    feesPresent: false,
  };
  if (!body) return empty;
  const fees = Array.isArray(body.fees)
    ? body.fees
    : Array.isArray(body.estimated_fees)
      ? body.estimated_fees
      : null;
  let providerFeeMinor = 0;
  let crossBorderFeeMinor = 0;
  let fxFeeMinor = 0;
  if (fees) {
    for (const f of fees) {
      if (!f || typeof f !== "object") continue;
      const fee = f as { type?: string; amount?: { value?: number } };
      const val = typeof fee.amount?.value === "number" ? fee.amount.value : 0;
      if (!Number.isInteger(val) || val < 0) continue;
      const t = String(fee.type || "").toLowerCase();
      if (t.includes("cross")) crossBorderFeeMinor += val;
      else if (t.includes("fx") || t.includes("exchange")) fxFeeMinor += val;
      else providerFeeMinor += val;
    }
  }
  const toRecord =
    body.to && typeof body.to === "object"
      ? (body.to as {
          amount?: { value?: number; currency?: string };
          credited?: { value?: number; currency?: string };
        })
      : undefined;
  const toAmount = toRecord?.credited ?? toRecord?.amount;
  const destinationAmountMinor =
    typeof toAmount?.value === "number" && Number.isInteger(toAmount.value)
      ? toAmount.value
      : 0;
  const destinationCurrency =
    typeof toAmount?.currency === "string" ? toAmount.currency : "";
  const fx =
    body.exchange_rate != null
      ? String(body.exchange_rate)
      : body.fx_rate != null
        ? String(body.fx_rate)
        : "";
  return {
    providerFeeMinor,
    crossBorderFeeMinor,
    fxFeeMinor,
    destinationCurrency,
    destinationAmountMinor,
    fxRateSnapshot: fx.slice(0, 64),
    feesPresent: fees != null,
  };
}

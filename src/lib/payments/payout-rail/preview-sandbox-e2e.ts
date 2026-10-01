/**
 * Preview-only Sandbox Global Payouts release for one labelled fixture.
 * Stripe money creation goes only through releaseFinal. This module never
 * posts an OutboundPayment itself. Caller parameters are ignored.
 */

import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { computeProtectedFinancials } from "@/lib/payments/breakdown";
import {
  SOURCE_BRIDGE_FEE_BPS,
  SOURCE_BRIDGE_FEE_FLOOR_MINOR,
} from "@/lib/payments/config";
import { calculateFees } from "@/lib/payments/fees";
import {
  getStripeMode,
  isLivePaymentsEnabled,
  isPaymentsEnabled,
} from "@/lib/payments/flags";
import { isStripeConfigured } from "@/lib/payments/stripe/client";
import { canInitiateGlobalPayoutsMoney } from "@/lib/payments/payout-rail/eligibility";
import {
  getGlobalPayoutsFinancialAccountId,
  gpFetch,
} from "@/lib/payments/payout-rail/gp-client";
import { releaseFinal } from "@/lib/payments/release";
import { reconcileOutboundAttempt } from "@/lib/payments/payout-rail/reconcile";
import { mapOutboundPaymentProviderStatus } from "@/lib/payments/payout-rail/status-mapper";
import {
  discoverSandboxFixture,
  discoveryHash8,
} from "@/lib/payments/payout-rail/preview-sandbox-discovery";
import {
  isValidUsername,
  normalizeUsername,
  slugFromUsername,
} from "@/lib/validation";

const PREVIEW_HOST_H8 = "bf232aa9";
const SELLER_USERNAME = "testingtesting";
const SELLER_USER_H8 = "e26bfc64";
const RECIPIENT_H8 = "3525542e";
const PAYOUT_METHOD_H8 = "574fcb48";
const FIXTURE_TITLE = "GP_SANDBOX_E2E_FIXTURE_v1";
const BUYER = {
  username: normalizeUsername("gpsandboxbuyer"),
  name: "GP Sandbox Synthetic Buyer",
  email: "gp-sandbox-buyer@example.invalid",
};
/** Published Stripe Global Payouts destination minimum for Thailand. */
const THB_DESTINATION_MINIMUM_MINOR = 60000;
/**
 * Integration sends one currency. USD must still convert to at least 600 THB.
 * 5000 minor units is 50.00 USD, which clears 600 THB at 12 THB per USD.
 */
const USD_SOURCE_MINOR = 5000;
const FEE_CONFIG = {
  protectionFeeBps: SOURCE_BRIDGE_FEE_BPS,
  protectionFeeFloorMinor: SOURCE_BRIDGE_FEE_FLOOR_MINOR,
  sellerServiceFeeBps: 0,
  directServiceFeeBps: SOURCE_BRIDGE_FEE_BPS,
  directServiceFeeFloorMinor: SOURCE_BRIDGE_FEE_FLOOR_MINOR,
};

type CashBalance = { currency: string; value: number };

export type SandboxE2eReport = {
  ok: boolean;
  status: "GP_SANDBOX_E2E_PASS" | "GP_SANDBOX_E2E_BLOCKED";
  blocker: string | null;
  stripe_creation: "not_attempted" | "submitted" | "rejected" | "uncertain";
  terminal_completion: "pending" | "completed" | "not_applicable";
  deployment_commit: string;
  host_h8: string | null;
  user_id_h8: string | null;
  recipient_h8: string | null;
  payout_method_h8: string | null;
  livemode_is_false: boolean | null;
  fixture_txn_h8: string | null;
  amount_minor: number | null;
  currency: string | null;
  attempt_count: number;
  attempt_h8: string | null;
  attempt_status: string | null;
  outbound_prefix: string | null;
  outbound_h8: string | null;
  stripe_status: string | null;
  application_transaction_status: string | null;
  application_payment_status: string | null;
  mapping_matches: boolean | null;
  duplicate_reconciliation: string;
  connect_transfer_count: number | null;
  initiation_setting: "false";
  initiation_runtime_is_false: boolean;
  production_untouched: true;
  connect_untouched: true;
  stripe_writes: 0 | 1;
  db_rows_written: number;
};

function previewHostH8(): string | null {
  const raw = String(process.env.DATABASE_URL || "").trim();
  if (!raw) return null;
  try {
    const host = new URL(raw.replace(/^postgresql:/, "postgres:")).hostname;
    return discoveryHash8(host);
  } catch {
    return null;
  }
}

function initiationIsFalse(): boolean {
  const raw = String(process.env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED || "")
    .trim()
    .toLowerCase();
  return raw === "false" || raw === "0";
}

function termsHash(): string {
  return createHash("sha256").update(FIXTURE_TITLE).digest("hex");
}

function outboundPrefix(id: string): string | null {
  const value = String(id || "");
  if (value.startsWith("obp_")) return "obp_";
  return null;
}

function safeStripeStatus(body: Record<string, unknown> | null): string | null {
  const raw = String(body?.status || body?.state || "").toLowerCase();
  if (!/^[a-z0-9_]{1,40}$/.test(raw)) return null;
  return raw;
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as Record<string, unknown>;
}

function minorValue(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === "string" && /^-?\d+$/.test(raw)) return Number(raw);
  return null;
}

function availableBalances(body: Record<string, unknown>): CashBalance[] {
  const balance = asRecord(body.balance);
  const available = asRecord(balance?.available);
  if (!available) return [];
  const found: CashBalance[] = [];
  const direct = minorValue(available.value);
  if (direct != null && typeof available.currency === "string") {
    found.push({ currency: available.currency.toLowerCase(), value: direct });
  }
  for (const [key, value] of Object.entries(available)) {
    if (key === "value" || key === "currency") continue;
    const row = asRecord(value);
    const amount = minorValue(row?.value);
    if (!row || amount == null) continue;
    const currency =
      typeof row.currency === "string" ? row.currency.toLowerCase() : key.toLowerCase();
    if (!/^[a-z]{3}$/.test(currency)) continue;
    found.push({ currency, value: amount });
  }
  return found;
}

function quote(itemCostMinor: number) {
  const fees = calculateFees({
    itemCostMinor,
    shippingMinor: 0,
    sellerServiceFeeMinorOverride: 0,
    paymentOption: "PROTECTED",
    config: FEE_CONFIG,
  });
  const totalChargeMinor =
    fees.itemCostMinor + fees.shippingMinor + fees.sellerServiceFeeMinor + fees.protectionFeeMinor;
  const books = computeProtectedFinancials({
    itemCostMinor: fees.itemCostMinor,
    shippingMinor: fees.shippingMinor,
    sellerServiceFeeMinor: fees.sellerServiceFeeMinor,
    protectionFeeMinor: fees.protectionFeeMinor,
    totalChargeMinor,
  });
  return { fees, totalChargeMinor, residual: books.finalResidualMinor };
}

function choosePayout(balances: CashBalance[]): {
  currency: "USD" | "THB";
  itemCostMinor: number;
  availableMinor: number;
} | null {
  const thb = balances.find((row) => row.currency === "thb");
  const usd = balances.find((row) => row.currency === "usd");
  if (thb && thb.value >= THB_DESTINATION_MINIMUM_MINOR) {
    return { currency: "THB", itemCostMinor: THB_DESTINATION_MINIMUM_MINOR, availableMinor: thb.value };
  }
  if (usd && usd.value >= USD_SOURCE_MINOR) {
    return { currency: "USD", itemCostMinor: USD_SOURCE_MINOR, availableMinor: usd.value };
  }
  return null;
}

function baseReport(partial: Partial<SandboxE2eReport>): SandboxE2eReport {
  return {
    ok: false,
    status: "GP_SANDBOX_E2E_BLOCKED",
    blocker: null,
    stripe_creation: "not_attempted",
    terminal_completion: "not_applicable",
    deployment_commit: String(process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 12),
    host_h8: previewHostH8(),
    user_id_h8: null,
    recipient_h8: null,
    payout_method_h8: null,
    livemode_is_false: null,
    fixture_txn_h8: null,
    amount_minor: null,
    currency: null,
    attempt_count: 0,
    attempt_h8: null,
    attempt_status: null,
    outbound_prefix: null,
    outbound_h8: null,
    stripe_status: null,
    application_transaction_status: null,
    application_payment_status: null,
    mapping_matches: null,
    duplicate_reconciliation: "no_release",
    connect_transfer_count: null,
    initiation_setting: "false",
    initiation_runtime_is_false: initiationIsFalse(),
    production_untouched: true,
    connect_untouched: true,
    stripe_writes: 0,
    db_rows_written: 0,
    ...partial,
  };
}

function blocked(blocker: string, partial: Partial<SandboxE2eReport> = {}): SandboxE2eReport {
  return baseReport({ ...partial, blocker, ok: false, status: "GP_SANDBOX_E2E_BLOCKED" });
}

async function listMatchingOutbound(txnId: string): Promise<{
  count: number | null;
  ids: string[];
  statuses: string[];
}> {
  const ids: string[] = [];
  const statuses: string[] = [];
  let path = "/v2/money_management/outbound_payments?limit=20";
  const seen = new Set<string>();
  for (let page = 0; page < 4; page += 1) {
    if (seen.has(path)) break;
    seen.add(path);
    const res = await gpFetch({ mode: "TEST", method: "GET", path });
    if (!res.ok || !Array.isArray(res.body.data)) return { count: null, ids, statuses };
    for (const raw of res.body.data) {
      const row = asRecord(raw);
      const metadata = asRecord(row?.metadata);
      const id = typeof row?.id === "string" ? row.id : "";
      if (!id || metadata?.protectedTxnId !== txnId) continue;
      ids.push(id);
      const status = safeStripeStatus(row);
      if (status) statuses.push(status);
    }
    const next = res.body.next_page_url;
    if (typeof next === "string" && next.startsWith("/v2/money_management/outbound_payments")) {
      path = next;
      continue;
    }
    break;
  }
  return { count: ids.length, ids, statuses };
}

async function readFinancialAccount(): Promise<
  | { ok: true; livemodeFalse: boolean; balances: CashBalance[] }
  | { ok: false; blocker: string }
> {
  const faId = getGlobalPayoutsFinancialAccountId("TEST");
  if (!faId.startsWith("fa_test_")) return { ok: false, blocker: "financial_account_not_test" };
  const res = await gpFetch({
    mode: "TEST",
    method: "GET",
    path: `/v2/money_management/financial_accounts/${encodeURIComponent(faId)}`,
  });
  if (!res.ok) return { ok: false, blocker: "financial_account_unreadable" };
  if (res.body.livemode !== false) return { ok: false, blocker: "financial_account_livemode" };
  if (res.body.status !== "open") return { ok: false, blocker: "financial_account_not_open" };
  const balances = availableBalances(res.body);
  if (balances.length === 0) return { ok: false, blocker: "financial_account_balance_unconfirmed" };
  return { ok: true, livemodeFalse: true, balances };
}

async function reportPersisted(opts: {
  txnId: string;
  stripeWrites: 0 | 1;
  dbRowsWritten: number;
  stripeCreation: SandboxE2eReport["stripe_creation"];
}): Promise<SandboxE2eReport> {
  const txn = await prisma.protectedTransaction.findUnique({ where: { id: opts.txnId } });
  const attempts = await prisma.outboundPaymentAttempt.findMany({
    where: { protectedTxnId: opts.txnId },
    orderBy: { createdAt: "asc" },
  });
  const transfers = await prisma.transferAttempt.count({ where: { protectedTxnId: opts.txnId } });
  const attempt = attempts[0] || null;
  let stripeStatus: string | null = null;
  let mappingMatches: boolean | null = null;
  let outboundCount: number | null = null;

  if (attempt?.stripeOutboundPaymentId && attempt.status === "PROCESSING") {
    await reconcileOutboundAttempt({ attemptId: attempt.id, force: true });
  }
  const freshAttempt = attempt
    ? await prisma.outboundPaymentAttempt.findUnique({ where: { id: attempt.id } })
    : null;
  const freshTxn = await prisma.protectedTransaction.findUnique({ where: { id: opts.txnId } });
  const providerId = freshAttempt?.stripeOutboundPaymentId || "";

  if (providerId) {
    const retrieved = await gpFetch({
      mode: "TEST",
      method: "GET",
      path: `/v2/money_management/outbound_payments/${encodeURIComponent(providerId)}`,
    });
    stripeStatus = retrieved.ok ? safeStripeStatus(retrieved.body) : null;
    if (retrieved.ok && freshAttempt) {
      const mapped = mapOutboundPaymentProviderStatus(retrieved.body);
      mappingMatches =
        freshAttempt.status === mapped ||
        (mapped === "SUCCEEDED" &&
          (freshAttempt.status === "SUCCEEDED" || freshAttempt.status === "RECONCILED"));
    }
    const listed = await listMatchingOutbound(opts.txnId);
    outboundCount = listed.count;
  }

  const duplicate =
    attempts.length === 1 && outboundCount === 1
      ? "single_attempt_single_outbound"
      : attempts.length === 1 && outboundCount == null && providerId
        ? "list_unavailable_db_single"
        : attempts.length > 1 || (outboundCount != null && outboundCount > 1)
          ? "duplicate"
          : providerId
            ? "single_attempt_provider_unlisted"
            : "no_provider_id";

  const terminal =
    freshAttempt?.status === "SUCCEEDED" || freshAttempt?.status === "RECONCILED"
      ? "completed"
      : providerId
        ? "pending"
        : "not_applicable";
  const processingPass =
    Boolean(providerId) &&
    attempts.length === 1 &&
    (outboundCount == null || outboundCount === 1) &&
    transfers === 0 &&
    mappingMatches !== false &&
    initiationIsFalse() &&
    (freshAttempt?.status === "PROCESSING" ||
      freshAttempt?.status === "SUCCEEDED" ||
      freshAttempt?.status === "RECONCILED");

  return baseReport({
    ok: processingPass,
    status: processingPass ? "GP_SANDBOX_E2E_PASS" : "GP_SANDBOX_E2E_BLOCKED",
    blocker: processingPass ? null : duplicate === "duplicate" ? "duplicate_outbound" : "submission_not_verified",
    stripe_creation: providerId ? "submitted" : opts.stripeCreation,
    terminal_completion: terminal,
    user_id_h8: SELLER_USER_H8,
    recipient_h8: RECIPIENT_H8,
    payout_method_h8: PAYOUT_METHOD_H8,
    livemode_is_false: true,
    fixture_txn_h8: discoveryHash8(opts.txnId),
    amount_minor: freshAttempt?.amountMinor ?? freshTxn?.itemCostMinor ?? null,
    currency: freshTxn?.currency ?? null,
    attempt_count: attempts.length,
    attempt_h8: freshAttempt ? discoveryHash8(freshAttempt.id) : null,
    attempt_status: freshAttempt?.status ?? null,
    outbound_prefix: outboundPrefix(providerId),
    outbound_h8: providerId ? discoveryHash8(providerId) : null,
    stripe_status: stripeStatus,
    application_transaction_status: freshTxn?.status ?? null,
    application_payment_status: freshAttempt?.status ?? null,
    mapping_matches: mappingMatches,
    duplicate_reconciliation: duplicate,
    connect_transfer_count: transfers,
    stripe_writes: opts.stripeWrites,
    db_rows_written: opts.dbRowsWritten,
  });
}

export async function runSandboxE2eRelease(): Promise<SandboxE2eReport> {
  const host_h8 = previewHostH8();
  if (host_h8 !== PREVIEW_HOST_H8) return blocked("database_host_mismatch", { host_h8 });
  if (!initiationIsFalse()) return blocked("initiation_not_false", { host_h8 });
  if (isLivePaymentsEnabled() || getStripeMode() !== "TEST") {
    return blocked("platform_not_test", { host_h8 });
  }
  if (!canInitiateGlobalPayoutsMoney("TEST")) {
    return blocked("test_initiation_unavailable", { host_h8 });
  }
  if (!isPaymentsEnabled() || !isStripeConfigured()) {
    return blocked("stripe_not_configured", { host_h8 });
  }
  if (!isValidUsername(BUYER.username) || slugFromUsername(BUYER.username) !== BUYER.username) {
    return blocked("buyer_username_invalid", { host_h8 });
  }

  const discovered = await discoverSandboxFixture();
  if (
    !discovered.ok ||
    !discovered.fixtureIds ||
    discovered.recipient?.livemode_is_false !== true ||
    discovered.payout_method?.livemode_is_false !== true ||
    discovered.recipient.country !== "TH" ||
    discovered.payout_method.country !== "TH" ||
    discovered.recipient.payout_method_ready !== true ||
    discovered.recipient.selected_ready_method_matches_historical !== true ||
    discovered.payout_method.archived === true ||
    discoveryHash8(discovered.fixtureIds.recipientId) !== RECIPIENT_H8 ||
    discoveryHash8(discovered.fixtureIds.payoutMethodId) !== PAYOUT_METHOD_H8
  ) {
    return blocked("live_fixture_not_ready", {
      host_h8,
      recipient_h8: RECIPIENT_H8,
      payout_method_h8: PAYOUT_METHOD_H8,
      livemode_is_false: false,
    });
  }

  const seller = await prisma.user.findFirst({
    where: { username: SELLER_USERNAME },
    include: { globalPayoutRecipients: true },
  });
  const recipient = seller?.globalPayoutRecipients.find((row) => row.stripeMode === "TEST");
  if (
    !seller ||
    discoveryHash8(seller.id) !== SELLER_USER_H8 ||
    seller.passwordHash != null ||
    !recipient ||
    recipient.stripeRecipientId !== discovered.fixtureIds.recipientId ||
    recipient.defaultPayoutMethodId !== discovered.fixtureIds.payoutMethodId ||
    recipient.payoutMethodReady !== true
  ) {
    return blocked("seller_mapping_mismatch", { host_h8, user_id_h8: seller ? discoveryHash8(seller.id) : null });
  }

  const fa = await readFinancialAccount();
  if (!fa.ok) {
    return blocked(fa.blocker, {
      host_h8,
      user_id_h8: SELLER_USER_H8,
      recipient_h8: RECIPIENT_H8,
      payout_method_h8: PAYOUT_METHOD_H8,
      livemode_is_false: fa.blocker !== "financial_account_livemode",
    });
  }
  const payout = choosePayout(fa.balances);

  const fixtures = await prisma.protectedTransaction.findMany({ where: { title: FIXTURE_TITLE } });
  const otherTxns = await prisma.protectedTransaction.count({
    where: { title: { not: FIXTURE_TITLE } },
  });
  const otherAttempts = await prisma.outboundPaymentAttempt.count({
    where: { protectedTxn: { title: { not: FIXTURE_TITLE } } },
  });
  if (fixtures.length > 1) return blocked("duplicate_fixture", { host_h8, user_id_h8: SELLER_USER_H8 });
  if (otherTxns > 0 || otherAttempts > 0) {
    return blocked("unexpected_existing_money_rows", { host_h8, user_id_h8: SELLER_USER_H8 });
  }

  let txn = fixtures[0] || null;
  let dbRowsWritten = 0;
  if (txn) {
    const attempts = await prisma.outboundPaymentAttempt.findMany({
      where: { protectedTxnId: txn.id },
    });
    if (
      txn.buyerId === txn.sellerId ||
      txn.sellerId !== seller.id ||
      txn.payoutRail !== "STRIPE_GLOBAL_PAYOUTS" ||
      txn.stripeMode !== "TEST" ||
      txn.sellerGpRecipientId !== discovered.fixtureIds.recipientId ||
      txn.sellerGpPayoutMethodId !== discovered.fixtureIds.payoutMethodId ||
      txn.stripeChargeId !== "" ||
      txn.stripePaymentIntentId !== ""
    ) {
      return blocked("fixture_mismatch", {
        host_h8,
        user_id_h8: SELLER_USER_H8,
        fixture_txn_h8: discoveryHash8(txn.id),
      });
    }
    if (attempts.length > 1) {
      return blocked("duplicate_attempt", {
        host_h8,
        fixture_txn_h8: discoveryHash8(txn.id),
        attempt_count: attempts.length,
        duplicate_reconciliation: "duplicate",
      });
    }
    if (attempts.length === 1 && attempts[0].stripeOutboundPaymentId) {
      return reportPersisted({
        txnId: txn.id,
        stripeWrites: 0,
        dbRowsWritten: 0,
        stripeCreation: "submitted",
      });
    }
    if (attempts.length === 1) {
      const listed = await listMatchingOutbound(txn.id);
      if (listed.count == null) {
        return blocked("stripe_creation_uncertain", {
          host_h8,
          fixture_txn_h8: discoveryHash8(txn.id),
          attempt_count: 1,
          attempt_h8: discoveryHash8(attempts[0].id),
          attempt_status: attempts[0].status,
          stripe_creation: "uncertain",
          duplicate_reconciliation: "uncertain_no_provider_id",
        });
      }
      if (listed.count > 0) {
        return blocked("stripe_creation_uncertain", {
          host_h8,
          fixture_txn_h8: discoveryHash8(txn.id),
          attempt_count: 1,
          attempt_h8: discoveryHash8(attempts[0].id),
          attempt_status: attempts[0].status,
          outbound_h8: discoveryHash8(listed.ids[0] || ""),
          outbound_prefix: outboundPrefix(listed.ids[0] || ""),
          stripe_status: listed.statuses[0] || null,
          stripe_creation: "uncertain",
          duplicate_reconciliation: listed.count === 1 ? "provider_found_unpersisted" : "duplicate",
        });
      }
      return blocked("prior_attempt_without_provider", {
        host_h8,
        fixture_txn_h8: discoveryHash8(txn.id),
        attempt_count: 1,
        attempt_h8: discoveryHash8(attempts[0].id),
        attempt_status: attempts[0].status,
        stripe_creation: "rejected",
        duplicate_reconciliation: "no_provider_id",
      });
    }
  }

  if (!payout) {
    const summary = fa.balances
      .filter((row) => row.currency === "usd" || row.currency === "thb")
      .map((row) => `${row.currency}:${row.value}`)
      .join(",");
    return blocked(
      summary
        ? `financial_account_cannot_cover_minimum:${summary}`
        : "financial_account_cannot_cover_minimum",
      {
        host_h8,
        user_id_h8: SELLER_USER_H8,
        recipient_h8: RECIPIENT_H8,
        payout_method_h8: PAYOUT_METHOD_H8,
        livemode_is_false: true,
      },
    );
  }
  const priced = quote(payout.itemCostMinor);
  if (priced.residual !== payout.itemCostMinor) {
    return blocked("residual_mismatch", { host_h8, user_id_h8: SELLER_USER_H8 });
  }
  if (
    txn &&
    (txn.currency !== payout.currency ||
      txn.itemCostMinor !== priced.fees.itemCostMinor ||
      txn.protectionFeeMinor !== priced.fees.protectionFeeMinor)
  ) {
    return blocked("existing_fixture_amount_mismatch", {
      host_h8,
      fixture_txn_h8: discoveryHash8(txn.id),
      amount_minor: txn.itemCostMinor,
      currency: txn.currency,
    });
  }

  if (!txn) {
    const created = await prisma.$transaction(async (tx) => {
      const again = await tx.protectedTransaction.findMany({ where: { title: FIXTURE_TITLE } });
      if (again.length > 0) return { kind: "exists" as const, id: again[0].id };
      const buyers = await tx.user.findMany({
        where: { OR: [{ email: BUYER.email }, { username: BUYER.username }, { slug: BUYER.username }] },
      });
      if (buyers.length > 1) return { kind: "conflict" as const };
      let buyer = buyers[0];
      if (buyer) {
        const exact =
          buyer.email === BUYER.email &&
          buyer.name === BUYER.name &&
          buyer.username === BUYER.username &&
          buyer.passwordHash == null &&
          buyer.isTestAccount === true &&
          buyer.id !== seller.id;
        if (!exact) return { kind: "conflict" as const };
      } else {
        buyer = await tx.user.create({
          data: {
            email: BUYER.email,
            name: BUYER.name,
            username: BUYER.username,
            slug: BUYER.username,
            passwordHash: null,
            isTestAccount: true,
            isDiscoverable: false,
          },
        });
      }
      const row = await tx.protectedTransaction.create({
        data: {
          title: FIXTURE_TITLE,
          status: "READY_TO_RELEASE",
          origin: "CHAT_TICKET",
          paymentOption: "PROTECTED",
          buyerId: buyer.id,
          sellerId: seller.id,
          currency: payout.currency,
          stripeMode: "TEST",
          termsHash: termsHash(),
          itemCostMinor: priced.fees.itemCostMinor,
          shippingMinor: 0,
          sellerServiceFeeMinor: 0,
          protectionFeeMinor: priced.fees.protectionFeeMinor,
          totalChargeMinor: priced.totalChargeMinor,
          payoutRail: "STRIPE_GLOBAL_PAYOUTS",
          payoutRailLockedAt: new Date(),
          sellerGpRecipientId: discovered.fixtureIds!.recipientId,
          sellerGpPayoutMethodId: discovered.fixtureIds!.payoutMethodId,
          stripePaymentIntentId: "",
          stripeChargeId: "",
          sellerConnectAccountId: "",
        },
      });
      return { kind: "created" as const, id: row.id, buyerCreated: !buyers[0] };
    });
    if (created.kind === "conflict") return blocked("buyer_conflict", { host_h8, user_id_h8: SELLER_USER_H8 });
    txn = await prisma.protectedTransaction.findUniqueOrThrow({ where: { id: created.id } });
    if (created.kind === "created") dbRowsWritten = created.buyerCreated ? 2 : 1;
  }

  if (txn.status !== "READY_TO_RELEASE") {
    return blocked("fixture_not_releasable", {
      host_h8,
      fixture_txn_h8: discoveryHash8(txn.id),
      application_transaction_status: txn.status,
    });
  }

  const before = await prisma.outboundPaymentAttempt.findMany({ where: { protectedTxnId: txn.id } });
  if (before.length > 0) {
    return blocked("attempt_appeared_before_release", {
      host_h8,
      fixture_txn_h8: discoveryHash8(txn.id),
      attempt_count: before.length,
      stripe_creation: before[0]?.stripeOutboundPaymentId ? "uncertain" : "not_attempted",
    });
  }

  try {
    await releaseFinal({ protectedTxnId: txn.id });
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
    const after = await prisma.outboundPaymentAttempt.findMany({ where: { protectedTxnId: txn.id } });
    const providerId = after.find((row) => row.stripeOutboundPaymentId)?.stripeOutboundPaymentId || "";
    if (providerId) {
      return reportPersisted({
        txnId: txn.id,
        stripeWrites: 1,
        dbRowsWritten,
        stripeCreation: "submitted",
      });
    }
    if (code === "GP_OUTBOUND_CREATE_FAILED" || code === "GP_AWAITING_MINIMUM" || code === "GP_AWAITING_FA_FUNDS") {
      return blocked(code.toLowerCase(), {
        host_h8,
        user_id_h8: SELLER_USER_H8,
        fixture_txn_h8: discoveryHash8(txn.id),
        amount_minor: txn.itemCostMinor,
        currency: txn.currency,
        attempt_count: after.length,
        attempt_h8: after[0] ? discoveryHash8(after[0].id) : null,
        attempt_status: after[0]?.status ?? null,
        stripe_creation: "rejected",
        db_rows_written: dbRowsWritten,
        stripe_writes: code === "GP_OUTBOUND_CREATE_FAILED" ? 1 : 0,
      });
    }
    return blocked("stripe_creation_uncertain", {
      host_h8,
      fixture_txn_h8: discoveryHash8(txn.id),
      amount_minor: txn.itemCostMinor,
      currency: txn.currency,
      attempt_count: after.length,
      attempt_h8: after[0] ? discoveryHash8(after[0].id) : null,
      attempt_status: after[0]?.status ?? null,
      stripe_creation: "uncertain",
      db_rows_written: dbRowsWritten,
    });
  }

  return reportPersisted({
    txnId: txn.id,
    stripeWrites: 1,
    dbRowsWritten,
    stripeCreation: "submitted",
  });
}

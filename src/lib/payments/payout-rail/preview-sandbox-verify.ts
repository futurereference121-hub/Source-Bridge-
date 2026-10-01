/**
 * Read-only Preview verification of the labelled Sandbox fixture.
 * Stripe calls are GET only. The request cannot choose an ID or a database.
 */

import { prisma } from "@/lib/db";
import { getGlobalPayoutsFinancialAccountId, gpFetch } from "@/lib/payments/payout-rail/gp-client";
import { discoveryHash8 } from "@/lib/payments/payout-rail/preview-sandbox-discovery";
import {
  buildSandboxPaymentVerification,
  SANDBOX_VERIFY_FIXTURE,
  type ListedOutbound,
  type RetrievedOutbound,
  type RetrievedQuote,
} from "@/lib/payments/payout-rail/preview-sandbox-verify-report";

const FIXTURE_TITLE = "GP_SANDBOX_E2E_FIXTURE_v1";
const MAX_LIST_PAGES = 20;

function previewHostH8(): string | null {
  const raw = String(process.env.DATABASE_URL || "").trim();
  if (!raw) return null;
  try {
    return discoveryHash8(new URL(raw.replace(/^postgresql:/, "postgres:")).hostname);
  } catch {
    return null;
  }
}

function initiationIsFalse(): boolean {
  const raw = String(process.env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED || "").trim().toLowerCase();
  return raw === "false" || raw === "0";
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as Record<string, unknown>;
}

function readPayment(body: Record<string, unknown>): ListedOutbound | null {
  const amount = asRecord(body.amount);
  const from = asRecord(body.from);
  const to = asRecord(body.to);
  const metadata = asRecord(body.metadata);
  const value = amount?.value;
  return {
    id: typeof body.id === "string" ? body.id : "",
    recipient: typeof to?.recipient === "string" ? to.recipient : "",
    payoutMethod: typeof to?.payout_method === "string" ? to.payout_method : "",
    financialAccount: typeof from?.financial_account === "string" ? from.financial_account : "",
    amountMinor: typeof value === "number" && Number.isInteger(value) ? value : null,
    currency: typeof amount?.currency === "string" ? amount.currency : "",
    metadataTxnId: typeof metadata?.protectedTxnId === "string" ? metadata.protectedTxnId : "",
    status: typeof body.status === "string" ? body.status : "",
    livemode: typeof body.livemode === "boolean" ? body.livemode : null,
  };
}

function minorField(raw: unknown): number | null {
  return typeof raw === "number" && Number.isInteger(raw) ? raw : null;
}

function currencyField(raw: unknown): string | null {
  const code = String(raw || "").trim().toLowerCase();
  return /^[a-z]{3}$/.test(code) ? code : null;
}

async function listOutbound(recipientId: string): Promise<{ complete: boolean; listed: ListedOutbound[] }> {
  if (!recipientId.startsWith("acct_")) return { complete: false, listed: [] };
  const listed: ListedOutbound[] = [];
  let path = `/v2/money_management/outbound_payments?recipient=${encodeURIComponent(recipientId)}&limit=100`;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const res = await gpFetch({ mode: "TEST", method: "GET", path });
    if (!res.ok || !Array.isArray(res.body.data)) return { complete: false, listed };
    for (const raw of res.body.data) {
      const row = asRecord(raw);
      if (!row) return { complete: false, listed };
      const payment = readPayment(row);
      if (!payment) return { complete: false, listed };
      listed.push(payment);
    }
    const next = res.body.next_page_url;
    if (!next) return { complete: true, listed };
    if (typeof next !== "string" || !next.startsWith("https://api.stripe.com/v2/money_management/outbound_payments")) {
      return { complete: false, listed };
    }
    path = next.slice("https://api.stripe.com".length);
  }
  return { complete: false, listed };
}

export async function runSandboxPaymentVerification(): Promise<Record<string, unknown>> {
  const hostH8 = previewHostH8();
  const initiation = initiationIsFalse();
  const deploymentCommit = String(process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 12);
  const empty = {
    hostH8,
    initiationIsFalse: initiation,
    deploymentCommit,
    txn: null,
    attempts: [],
    financialAccountId: "",
    listComplete: false,
    listed: [],
    retrieved: null,
    quote: null,
    connectTransferCount: 0,
  };
  if (hostH8 !== SANDBOX_VERIFY_FIXTURE.hostH8 || !initiation) {
    return buildSandboxPaymentVerification(empty);
  }

  const fixtures = await prisma.protectedTransaction.findMany({
    where: { title: FIXTURE_TITLE },
    select: {
      id: true,
      status: true,
      stripeMode: true,
      currency: true,
      itemCostMinor: true,
      sellerGpRecipientId: true,
      sellerGpPayoutMethodId: true,
    },
  });
  const txn = fixtures.length === 1 ? fixtures[0] : null;
  if (!txn || discoveryHash8(txn.id) !== SANDBOX_VERIFY_FIXTURE.txnH8 || txn.stripeMode !== "TEST") {
    return buildSandboxPaymentVerification({ ...empty, txn });
  }

  const attempts = await prisma.outboundPaymentAttempt.findMany({
    where: { protectedTxnId: txn.id },
    select: {
      id: true,
      status: true,
      idempotencyKey: true,
      stripeOutboundPaymentId: true,
      fxRateSnapshot: true,
      amountMinor: true,
      currency: true,
      destinationCurrency: true,
      destinationAmountMinor: true,
      providerFeeMinor: true,
      crossBorderFeeMinor: true,
      fxFeeMinor: true,
      stripeRecipientId: true,
      stripePayoutMethodId: true,
      stripeMode: true,
    },
  });
  const connectTransferCount = await prisma.transferAttempt.count({
    where: { protectedTxnId: txn.id },
  });
  const corrected = attempts.filter((row) => row.idempotencyKey.endsWith("_quote_v1"));
  const correctedRow = corrected.length === 1 ? corrected[0] : null;
  const storedId = correctedRow?.stripeOutboundPaymentId || "";
  let retrieved: RetrievedOutbound | null = null;
  if (storedId.startsWith("obp_")) {
    const res = await gpFetch({
      mode: "TEST",
      method: "GET",
      path: `/v2/money_management/outbound_payments/${encodeURIComponent(storedId)}`,
    });
    const payment = res.ok ? readPayment(res.body) : null;
    retrieved = {
      ok: Boolean(res.ok && payment?.id),
      id: payment?.id || "",
      status: payment?.status || "",
      livemode: payment?.livemode ?? null,
      recipient: payment?.recipient || "",
      payoutMethod: payment?.payoutMethod || "",
      metadataTxnId: payment?.metadataTxnId || "",
    };
  } else if (storedId) {
    retrieved = {
      ok: false,
      id: "",
      status: "",
      livemode: null,
      recipient: "",
      payoutMethod: "",
      metadataTxnId: "",
    };
  }

  let quote: RetrievedQuote | null = null;
  let quoteId = "";
  if (correctedRow?.fxRateSnapshot) {
    try {
      const snap = JSON.parse(correctedRow.fxRateSnapshot) as { quoteId?: unknown };
      quoteId = typeof snap.quoteId === "string" ? snap.quoteId : "";
    } catch {
      quoteId = "";
    }
  }
  if (quoteId.startsWith("obpq_")) {
    const res = await gpFetch({
      mode: "TEST",
      method: "GET",
      path: `/v2/money_management/outbound_payment_quotes/${encodeURIComponent(quoteId)}`,
    });
    const amount = asRecord(res.body.amount);
    const to = asRecord(res.body.to);
    const credited = asRecord(to?.credited) || asRecord(to?.amount);
    quote = {
      attempted: true,
      ok: res.ok && res.body.id === quoteId,
      id: typeof res.body.id === "string" ? res.body.id : "",
      sourceAmountMinor: minorField(amount?.value),
      sourceCurrency: currencyField(amount?.currency),
      destinationAmountMinor: minorField(credited?.value),
      destinationCurrency: currencyField(credited?.currency),
    };
  }

  const listed = await listOutbound(txn.sellerGpRecipientId);
  const financialAccountId = getGlobalPayoutsFinancialAccountId("TEST");
  return buildSandboxPaymentVerification({
    hostH8,
    initiationIsFalse: initiation,
    deploymentCommit,
    txn,
    attempts,
    financialAccountId: financialAccountId.startsWith("fa_test_") ? financialAccountId : "",
    listComplete: listed.complete,
    listed: listed.listed,
    retrieved,
    quote,
    connectTransferCount,
  });
}

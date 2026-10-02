/**
 * Read-only Preview preflight for one normal TEST checkout.
 * No caller-supplied IDs. No user, payment, quote, or payout writes.
 */

import { prisma } from "@/lib/db";
import {
  getStripeMode,
  isGlobalPayoutsEnabled,
  isGlobalPayoutsLiveInitiationEnabled,
  isGlobalPayoutsSandboxEnabled,
  isPaymentsEnabled,
  isProtectedPaymentsEnabled,
} from "@/lib/payments/flags";
import {
  STRIPE_GP_API_VERSION,
  getGlobalPayoutsFinancialAccountId,
  gpFetch,
} from "@/lib/payments/payout-rail/gp-client";
import {
  CHECKOUT_PREFLIGHT_MARKER,
  EXPECTED_PREVIEW_HOST_H8,
  SOURCER_USERNAME,
  accountLoginFacts,
  isUsableCheckoutBuyer,
  preflightHash8,
  readFaAvailableBalances,
  type AccountLoginFacts,
} from "@/lib/payments/payout-rail/preview-checkout-preflight-report";

const FIXTURE_TITLE = "GP_SANDBOX_E2E_FIXTURE_v1";
const FIXTURE_TXN_H8 = "7162e1e3";
const USER_CAP = 40;

function previewHostH8(): string | null {
  const raw = String(process.env.DATABASE_URL || "").trim();
  if (!raw) return null;
  try {
    return preflightHash8(new URL(raw.replace(/^postgresql:/, "postgres:")).hostname);
  } catch {
    return null;
  }
}

function initiationRawIsFalse(): boolean {
  const raw = String(process.env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED || "").trim().toLowerCase();
  return raw === "false" || raw === "0";
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

async function platformTestGet(path: string): Promise<{
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}> {
  const key = String(process.env.STRIPE_SECRET_KEY_TEST || "").trim();
  if (!key.startsWith("sk_test_")) return { ok: false, status: 0, body: {} };
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Stripe-Version": STRIPE_GP_API_VERSION,
      Accept: "application/json",
    },
  });
  let body: Record<string, unknown> = {};
  try {
    const parsed = await res.json();
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  return { ok: res.ok, status: res.status, body };
}

async function readTestFinancialAccount() {
  const faId = getGlobalPayoutsFinancialAccountId("TEST");
  const prefixOk = faId.startsWith("fa_test_");
  if (!prefixOk) {
    return {
      configured: false,
      prefix: null as string | null,
      fa_h8: null as string | null,
      retrieve_ok: false,
      id_matches_configured: false,
      livemode_false: false,
      credential: "none",
      available_minor: null as number | null,
      currency: null as string | null,
    };
  }
  const restricted = await gpFetch({
    mode: "TEST",
    method: "GET",
    path: `/v2/money_management/financial_accounts/${encodeURIComponent(faId)}`,
  });
  const restrictedId = typeof restricted.body.id === "string" ? restricted.body.id : "";
  const idMatches = restricted.ok && restrictedId === faId;
  const livemodeFalse = restricted.body.livemode === false;
  let credential = "restricted_test";
  let balances = idMatches && livemodeFalse ? readFaAvailableBalances(restricted.body) : [];
  if (idMatches && livemodeFalse && balances.length === 0) {
    const platform = await platformTestGet(
      `/v2/money_management/financial_accounts/${encodeURIComponent(faId)}`,
    );
    const platformId = typeof platform.body.id === "string" ? platform.body.id : "";
    if (platform.ok && platformId === faId && platform.body.livemode === false) {
      credential = "platform_test_secret_proven";
      balances = readFaAvailableBalances(platform.body);
    }
  }
  const gbp = balances.find((row) => row.currency === "gbp") ?? null;
  return {
    configured: true,
    prefix: "fa_test_",
    fa_h8: preflightHash8(faId),
    retrieve_ok: restricted.ok,
    id_matches_configured: idMatches,
    livemode_false: livemodeFalse,
    credential,
    available_minor: gbp ? gbp.available_minor : balances.length === 1 ? balances[0].available_minor : null,
    currency: gbp ? gbp.currency : balances.length === 1 ? balances[0].currency : null,
    available_by_currency: balances,
  };
}

const userSelect = {
  id: true,
  email: true,
  emailVerified: true,
  passwordHash: true,
  onboardingComplete: true,
  mustChangePassword: true,
  isDemo: true,
  isTestAccount: true,
  deletedAt: true,
} as const;

export async function runCheckoutPreflight(): Promise<Record<string, unknown>> {
  const hostH8 = previewHostH8();
  const checkoutMode = getStripeMode();
  const base = {
    label: "GP_NORMAL_CHECKOUT_PREFLIGHT",
    host_h8: hostH8,
    expected_host_h8: EXPECTED_PREVIEW_HOST_H8,
    deployment_commit: String(process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 12),
    checkout_mode: checkoutMode,
    payments_enabled: isPaymentsEnabled(),
    protected_payments_enabled: isProtectedPaymentsEnabled(),
    global_payouts_enabled: isGlobalPayoutsEnabled(),
    global_payouts_sandbox_enabled: isGlobalPayoutsSandboxEnabled(),
    live_initiation_enabled: isGlobalPayoutsLiveInitiationEnabled(),
    initiation_raw_is_false: initiationRawIsFalse(),
    scenario_marker: CHECKOUT_PREFLIGHT_MARKER,
    mutations: { stripe_writes: 0, db_writes: 0 },
    production_untouched: true,
  };
  if (hostH8 !== EXPECTED_PREVIEW_HOST_H8) {
    return { ...base, ok: false, blocker: "database_host_mismatch" };
  }

  const sourcerRow = await prisma.user.findFirst({
    where: { username: SOURCER_USERNAME },
    select: userSelect,
  });
  const sourcer = sourcerRow ? accountLoginFacts(sourcerRow) : null;
  const buyers = await prisma.user.findMany({
    where: {
      deletedAt: null,
      emailVerified: true,
      isDemo: false,
      passwordHash: { not: null },
      NOT: { username: SOURCER_USERNAME },
    },
    select: userSelect,
    take: USER_CAP,
    orderBy: { createdAt: "asc" },
  });
  const [otherUsers, otherVerified, otherWithPassword] = await Promise.all([
    prisma.user.count({
      where: { deletedAt: null, NOT: { username: SOURCER_USERNAME } },
    }),
    prisma.user.count({
      where: { deletedAt: null, emailVerified: true, NOT: { username: SOURCER_USERNAME } },
    }),
    prisma.user.count({
      where: { deletedAt: null, passwordHash: { not: null }, NOT: { username: SOURCER_USERNAME } },
    }),
  ]);
  const usable: AccountLoginFacts[] = [];
  for (const row of buyers) {
    const facts = accountLoginFacts(row);
    if (isUsableCheckoutBuyer(facts, sourcer?.user_h8 ?? null)) usable.push(facts);
  }

  const recipient = sourcerRow
    ? await prisma.globalPayoutRecipient.findUnique({
        where: { userId_stripeMode: { userId: sourcerRow.id, stripeMode: "TEST" } },
        select: {
          status: true,
          country: true,
          payoutMethodReady: true,
          stripeRecipientId: true,
          defaultPayoutMethodId: true,
        },
      })
    : null;

  const marker = CHECKOUT_PREFLIGHT_MARKER;
  const [txns, tickets, requests] = await Promise.all([
    prisma.protectedTransaction.findMany({
      where: { title: { contains: marker } },
      select: { id: true, status: true, stripeMode: true, currency: true, payoutRail: true, origin: true },
      take: 10,
    }),
    prisma.paymentTicket.findMany({
      where: { title: { contains: marker } },
      select: { id: true, status: true, currency: true },
      take: 10,
    }),
    prisma.sourcingRequest.findMany({
      where: {
        OR: [{ message: { contains: marker } }, { clientRequestId: marker }],
      },
      select: { id: true, status: true },
      take: 10,
    }),
  ]);
  const fixture = await prisma.protectedTransaction.findFirst({
    where: { title: FIXTURE_TITLE },
    select: { id: true, status: true, stripeMode: true },
  });

  const financialAccount = await readTestFinancialAccount();
  const amountInputsMissing = true;

  return {
    ...base,
    ok: true,
    blocker: null,
    sourcer: sourcer
      ? {
          ...sourcer,
          sandbox_recipient: recipient
            ? {
                stripe_mode: "TEST",
                status: recipient.status,
                country: recipient.country,
                payout_method_ready: recipient.payoutMethodReady,
                recipient_h8: preflightHash8(recipient.stripeRecipientId),
                payout_method_h8: recipient.defaultPayoutMethodId
                  ? preflightHash8(recipient.defaultPayoutMethodId)
                  : null,
              }
            : null,
        }
      : null,
    other_user_count: otherUsers,
    other_verified_count: otherVerified,
    other_password_count: otherWithPassword,
    usable_buyer_count: usable.length,
    usable_buyer_scan_capped: buyers.length >= USER_CAP,
    usable_buyers: usable.map((row) => ({
      user_h8: row.user_h8,
      email_verified: row.email_verified,
      has_password: row.has_password,
      password_login_supported: row.password_login_supported,
      onboarding_complete: row.onboarding_complete,
      must_change_password: row.must_change_password,
      is_test_account: row.is_test_account,
    })),
    financial_account: financialAccount,
    funding: {
      adequacy: financialAccount.available_minor == null ? "unverified" : "amount_inputs_missing",
      amount_inputs_missing: amountInputsMissing,
      available_minor: financialAccount.available_minor,
      currency: financialAccount.currency,
    },
    scenario: {
      marker,
      protected_transactions: txns.map((row) => ({
        txn_h8: preflightHash8(row.id),
        status: row.status,
        stripe_mode: row.stripeMode,
        currency: row.currency,
        payout_rail: row.payoutRail,
        origin: row.origin,
      })),
      payment_tickets: tickets.map((row) => ({
        ticket_h8: preflightHash8(row.id),
        status: row.status,
        currency: row.currency,
      })),
      sourcing_requests: requests.map((row) => ({
        request_h8: preflightHash8(row.id),
        status: row.status,
      })),
    },
    fixture: fixture
      ? {
          txn_h8: preflightHash8(fixture.id),
          expected_h8: FIXTURE_TXN_H8,
          expected_match: preflightHash8(fixture.id) === FIXTURE_TXN_H8,
          status: fixture.status,
          stripe_mode: fixture.stripeMode,
        }
      : null,
  };
}

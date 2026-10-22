import { requireAdmin } from "@/lib/auth";
import { idHash8 } from "@/lib/payments/payout-rail/proceeds-preflight-shape";
import { isPlatformBalanceReadinessEnabled } from "@/lib/payments/flags";
import { prisma } from "@/lib/db";
import {
  DASHBOARD_BANK_CONFIRMATION_EVIDENCE,
  DASHBOARD_BANK_CONFIRMATION_LIVE_STATEMENT,
  DASHBOARD_BANK_CONFIRMATION_STATEMENT,
  assessLivePlatformAccount,
  assessTestPlatformAccount,
} from "@/lib/payments/payout-rail/platform-balance";
import { retrievedAccountLivemode } from "@/lib/payments/payout-rail/platform-bank-confirmation";
import { getStripe } from "@/lib/payments/stripe/client";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requestedStripeMode(body: { stripeMode?: unknown } | null): "TEST" | "LIVE" | null {
  const raw = body && typeof body.stripeMode === "string" ? body.stripeMode.trim().toUpperCase() : "";
  if (raw === "LIVE") return "LIVE";
  if (raw === "TEST" || raw === "") return "TEST";
  return null;
}

/**
 * Record an admin Dashboard confirmation for the TEST or LIVE platform GBP bank.
 * The account id is read from Stripe. The client cannot name an account.
 * TEST uses the TEST client and Balance.livemode === false.
 * LIVE uses the LIVE client and requires Balance.livemode === true.
 * This does not verify the bank through the Stripe API and does not pay out.
 */
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = await request.json().catch(() => null);
    const stripeMode = requestedStripeMode(body);
    const currency = body && typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "";
    const evidence = body && typeof body.evidence === "string" ? body.evidence.trim() : "";
    const statement = body && typeof body.statement === "string" ? body.statement.trim() : "";
    if (!stripeMode) return jsonError("Only TEST or LIVE can be confirmed", 409);
    if (currency === "USD") return jsonError("USD bank is unresolved", 409);
    if (currency !== "GBP") return jsonError("Only GBP can be confirmed", 409);
    if (evidence !== DASHBOARD_BANK_CONFIRMATION_EVIDENCE) return jsonError("Dashboard evidence is required", 409);
    if (!isPlatformBalanceReadinessEnabled(stripeMode)) {
      return jsonError(`${stripeMode} readiness is off`, 409);
    }

    if (stripeMode === "LIVE") {
      if (statement !== DASHBOARD_BANK_CONFIRMATION_LIVE_STATEMENT) {
        return jsonError("Confirmation statement does not match", 409);
      }
      const stripe = getStripe("LIVE");
      const account = await stripe.accounts.retrieve();
      const balance = await stripe.balance.retrieve();
      const assessed = assessLivePlatformAccount({
        stripeMode: "LIVE",
        accountId: account.id || "",
        accountLivemode: retrievedAccountLivemode(account),
        modeEvidenceLivemode: typeof balance.livemode === "boolean" ? balance.livemode : null,
      });
      if (!assessed.ok) {
        if (assessed.code === "ACCOUNT_IDENTITY_MISMATCH") {
          return jsonError("LIVE account does not match the confirmed Dashboard account", 409);
        }
        if (assessed.code === "LIVE_MODE_EVIDENCE_MISSING" || assessed.code === "TEST_ACCOUNT_OBJECT") {
          return jsonError("LIVE balance was not retrieved", 409);
        }
        return jsonError("LIVE account was not retrieved", 409);
      }
      await recordConfirmation({
        stripeMode: "LIVE",
        hash8: assessed.hash8,
        suffix: assessed.suffix,
        statement: DASHBOARD_BANK_CONFIRMATION_LIVE_STATEMENT,
        confirmedByHash: idHash8(admin.id),
      });
      return Response.json({
        ok: true,
        recorded: true,
        stripeMode: "LIVE" as const,
        currency: "GBP" as const,
        evidence: DASHBOARD_BANK_CONFIRMATION_EVIDENCE,
        accountSuffix: assessed.suffix,
        accountHash8: assessed.hash8,
        bankConfigurationVerified: false,
      });
    }

    if (statement !== DASHBOARD_BANK_CONFIRMATION_STATEMENT) {
      return jsonError("Confirmation statement does not match", 409);
    }
    const stripe = getStripe("TEST");
    const account = await stripe.accounts.retrieve();
    const balance = await stripe.balance.retrieve();
    const assessed = assessTestPlatformAccount({
      stripeMode: "TEST",
      accountId: account.id || "",
      accountLivemode: retrievedAccountLivemode(account),
      modeEvidenceLivemode: typeof balance.livemode === "boolean" ? balance.livemode : null,
    });
    if (!assessed.ok) {
      if (assessed.code === "ACCOUNT_IDENTITY_MISMATCH") {
        return jsonError("TEST account does not match the confirmed Dashboard account", 409);
      }
      return jsonError("TEST account was not retrieved", 409);
    }

    await recordConfirmation({
      stripeMode: "TEST",
      hash8: assessed.hash8,
      suffix: assessed.suffix,
      statement: DASHBOARD_BANK_CONFIRMATION_STATEMENT,
      confirmedByHash: idHash8(admin.id),
    });

    return Response.json({
      ok: true,
      recorded: true,
      stripeMode: "TEST" as const,
      currency: "GBP" as const,
      evidence: DASHBOARD_BANK_CONFIRMATION_EVIDENCE,
      accountSuffix: assessed.suffix,
      accountHash8: assessed.hash8,
      bankConfigurationVerified: false,
    });
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number(err.status) : 500;
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
    if (status === 401) return jsonError("Unauthorized", 401);
    if (status === 403) return jsonError("Admin only", 403);
    if (code === "P2021") return jsonError("Confirmation storage is not migrated", 503);
    console.error("[platform-bank-dashboard-confirmation]", err instanceof Error ? err.name : "error");
    return jsonError("Confirmation was not recorded", 500);
  }
}

async function recordConfirmation(opts: {
  stripeMode: "TEST" | "LIVE";
  hash8: string;
  suffix: string;
  statement: string;
  confirmedByHash: string;
}) {
  await prisma.platformBankDashboardConfirmation.upsert({
    where: {
      stripeMode_currency_stripeAccountHash: {
        stripeMode: opts.stripeMode,
        currency: "GBP",
        stripeAccountHash: opts.hash8,
      },
    },
    create: {
      stripeMode: opts.stripeMode,
      currency: "GBP",
      stripeAccountHash: opts.hash8,
      accountSuffix: opts.suffix,
      evidence: DASHBOARD_BANK_CONFIRMATION_EVIDENCE,
      statement: opts.statement,
      confirmedByHash: opts.confirmedByHash,
    },
    update: {
      accountSuffix: opts.suffix,
      evidence: DASHBOARD_BANK_CONFIRMATION_EVIDENCE,
      statement: opts.statement,
      confirmedByHash: opts.confirmedByHash,
    },
  });
}

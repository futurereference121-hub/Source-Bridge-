import { requireAdmin } from "@/lib/auth";
import { idHash8 } from "@/lib/payments/payout-rail/proceeds-preflight-shape";
import { isPlatformBalanceReadinessEnabled } from "@/lib/payments/flags";
import { prisma } from "@/lib/db";
import {
  DASHBOARD_BANK_CONFIRMATION_EVIDENCE,
  DASHBOARD_BANK_CONFIRMATION_STATEMENT,
  assessTestPlatformAccount,
} from "@/lib/payments/payout-rail/platform-balance";
import { retrievedAccountLivemode } from "@/lib/payments/payout-rail/platform-bank-confirmation";
import { getStripe } from "@/lib/payments/stripe/client";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Record an admin Dashboard confirmation for the TEST platform GBP bank.
 * The account id is read from Stripe. The client cannot name an account.
 * TEST mode is established by the TEST client and Balance.livemode.
 * Account.livemode is not required by the pinned Account schema.
 * This does not verify the bank through the Stripe API and does not pay out.
 */
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    if (!isPlatformBalanceReadinessEnabled("TEST")) {
      return jsonError("TEST readiness is off", 409);
    }
    const body = await request.json().catch(() => null);
    const currency = body && typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "";
    const evidence = body && typeof body.evidence === "string" ? body.evidence.trim() : "";
    const statement = body && typeof body.statement === "string" ? body.statement.trim() : "";
    if (currency === "USD") return jsonError("USD bank is unresolved", 409);
    if (currency !== "GBP") return jsonError("Only GBP can be confirmed", 409);
    if (evidence !== DASHBOARD_BANK_CONFIRMATION_EVIDENCE) return jsonError("Dashboard evidence is required", 409);
    if (statement !== DASHBOARD_BANK_CONFIRMATION_STATEMENT) return jsonError("Confirmation statement does not match", 409);

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

    await prisma.platformBankDashboardConfirmation.upsert({
      where: {
        stripeMode_currency_stripeAccountHash: {
          stripeMode: "TEST",
          currency: "GBP",
          stripeAccountHash: assessed.hash8,
        },
      },
      create: {
        stripeMode: "TEST",
        currency: "GBP",
        stripeAccountHash: assessed.hash8,
        accountSuffix: assessed.suffix,
        evidence: DASHBOARD_BANK_CONFIRMATION_EVIDENCE,
        statement: DASHBOARD_BANK_CONFIRMATION_STATEMENT,
        confirmedByHash: idHash8(admin.id),
      },
      update: {
        accountSuffix: assessed.suffix,
        evidence: DASHBOARD_BANK_CONFIRMATION_EVIDENCE,
        statement: DASHBOARD_BANK_CONFIRMATION_STATEMENT,
        confirmedByHash: idHash8(admin.id),
      },
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

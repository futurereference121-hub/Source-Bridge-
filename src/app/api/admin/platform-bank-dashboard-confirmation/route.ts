import { requireAdmin } from "@/lib/auth";
import { idHash8 } from "@/lib/payments/payout-rail/proceeds-preflight-shape";
import { isPlatformBalanceReadinessEnabled } from "@/lib/payments/flags";
import { prisma } from "@/lib/db";
import {
  DASHBOARD_BANK_CONFIRMATION_ACCOUNT_SUFFIX,
  DASHBOARD_BANK_CONFIRMATION_EVIDENCE,
  DASHBOARD_BANK_CONFIRMATION_STATEMENT,
} from "@/lib/payments/payout-rail/platform-balance";
import { stripeAccountIdentity, retrievedAccountLivemode } from "@/lib/payments/payout-rail/platform-bank-confirmation";
import { getStripe } from "@/lib/payments/stripe/client";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Record an admin Dashboard confirmation for the TEST platform GBP bank.
 * The account id is read from Stripe. The client cannot name an account.
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

    const account = await getStripe("TEST").accounts.retrieve();
    if (retrievedAccountLivemode(account) !== false || !account.id) return jsonError("TEST account was not retrieved", 409);
    const identity = stripeAccountIdentity(account.id);
    if (identity.suffix !== DASHBOARD_BANK_CONFIRMATION_ACCOUNT_SUFFIX) {
      return jsonError("TEST account does not match the confirmed Dashboard account", 409);
    }

    await prisma.platformBankDashboardConfirmation.upsert({
      where: {
        stripeMode_currency_stripeAccountHash: {
          stripeMode: "TEST",
          currency: "GBP",
          stripeAccountHash: identity.hash8,
        },
      },
      create: {
        stripeMode: "TEST",
        currency: "GBP",
        stripeAccountHash: identity.hash8,
        accountSuffix: identity.suffix,
        evidence: DASHBOARD_BANK_CONFIRMATION_EVIDENCE,
        statement: DASHBOARD_BANK_CONFIRMATION_STATEMENT,
        confirmedByHash: idHash8(admin.id),
      },
      update: {
        accountSuffix: identity.suffix,
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
      accountSuffix: identity.suffix,
      accountHash8: identity.hash8,
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

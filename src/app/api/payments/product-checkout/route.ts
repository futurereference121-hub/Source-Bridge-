import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import { prisma } from "@/lib/db";
import {
  assertListingCheckoutOption,
  parseListingPaymentOptions,
} from "@/lib/payments/listing-options";
import {
  assertEligiblePaymentParty,
  assertNotSelfTrade,
} from "@/lib/payments/eligibility";
import {
  isDirectPaymentsEnabled,
  isProtectedPaymentsEnabled,
  getStripeMode,
} from "@/lib/payments/flags";
import { assertPaymentsTestAllowlisted } from "@/lib/payments/allowlist";
import { calculateFees } from "@/lib/payments/fees";
import { getPlatformPaymentConfig, assertCurrencyAllowed } from "@/lib/payments/config";
import { majorToMinor, normalizeCurrency, totalChargeMinor } from "@/lib/payments/money";
import { hashTerms, type CanonicalTerms } from "@/lib/payments/terms";
import { recordAuditEvent } from "@/lib/payments/ledger";
import { getConnectStatus } from "@/lib/payments/stripe/connect";
import {
  isDirectPaymentOption,
  normalizeTxnPaymentOption,
  platformFeePublicLabel,
} from "@/lib/payments/payment-option";

export const runtime = "nodejs";

const schema = z.object({
  listingId: z.string().trim().min(1),
  /** PROTECTED | DIRECT (preferred) | INSTANT (legacy alias for Direct). */
  paymentOption: z.enum(["PROTECTED", "INSTANT", "DIRECT"]),
  selectedSize: z.string().trim().max(40).optional(),
  shippingMinor: z.number().int().nonnegative().optional(),
});

/**
 * Product listing → Protected / Direct checkout (creates ProtectedTransaction).
 * Does not charge; buyer then calls /api/payments/checkout with the txn id.
 * Direct stores as INSTANT for money-flow compatibility.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }

    const listing = await prisma.stockListing.findUnique({
      where: { id: parsed.data.listingId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            isDemo: true,
            isTestAccount: true,
            isAdmin: true,
            role: true,
            username: true,
            deletedAt: true,
            trustLevel: true,
            procurementAdvancesEnabled: true,
            identityVerified: true,
          },
        },
      },
    });
    if (!listing) return jsonError("Listing not found", 404);
    if (listing.saleStatus !== "AVAILABLE") {
      return jsonError("Listing not available", 400);
    }
    if (listing.price == null) return jsonError("Listing has no price", 400);

    const listingOption = parseListingPaymentOptions(listing.paymentOptions);
    const selected = parsed.data.paymentOption;
    const storageOption = normalizeTxnPaymentOption(selected);
    const isDirect = isDirectPaymentOption(selected);

    assertListingCheckoutOption({
      listingOption,
      selected,
    });

    if (!isDirect && !isProtectedPaymentsEnabled()) {
      return jsonError("Protected Payments are not enabled", 503);
    }
    if (isDirect && !isDirectPaymentsEnabled()) {
      return jsonError("Direct Payment is not enabled", 503);
    }

    assertNotSelfTrade(user.id, listing.userId);
    const buyer = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        isDemo: true,
        isTestAccount: true,
        isAdmin: true,
        role: true,
        username: true,
        deletedAt: true,
        trustLevel: true,
        procurementAdvancesEnabled: true,
        identityVerified: true,
      },
    });
    assertEligiblePaymentParty(buyer, "buyer");
    assertEligiblePaymentParty(listing.user, "seller");
    assertPaymentsTestAllowlisted([buyer, listing.user], {
      action: "start product checkout",
      labels: ["buyer", "seller"],
    });

    const connect = await getConnectStatus(listing.userId);
    if (!connect.canReceiveProtectedPayments) {
      if (isDirect) {
        return jsonError(
          "Seller has not completed Payments & Payouts. Direct Payment is unavailable until Connect is ready.",
          409,
        );
      }
      return jsonError(
        "Seller has not completed Payments & Payouts onboarding",
        409,
      );
    }

    const config = await getPlatformPaymentConfig();
    const currency = normalizeCurrency(listing.currency || "USD");
    assertCurrencyAllowed(currency, config);
    const itemCostMinor = majorToMinor(listing.price, currency);
    // Snapshot listing price into ProtectedTransaction — paid purchases keep
    // these minor amounts even if the seller edits the listing later.
    // Server recalculates fees — never trust client totals.
    const fees = calculateFees({
      itemCostMinor,
      shippingMinor: parsed.data.shippingMinor ?? 0,
      config,
      paymentOption: storageOption,
    });
    const total = totalChargeMinor(fees);
    const feeLabel = platformFeePublicLabel(storageOption);
    const terms: CanonicalTerms = {
      currency,
      itemCostMinor: fees.itemCostMinor,
      shippingMinor: fees.shippingMinor,
      sellerServiceFeeMinor: fees.sellerServiceFeeMinor,
      protectionFeeMinor: fees.protectionFeeMinor,
      totalChargeMinor: total,
      paymentOption: storageOption,
      procurementAdvanceAgreed: false,
      procurementAdvanceMinor: 0,
      title: listing.name,
      listingId: listing.id,
      buyerId: user.id,
      sellerId: listing.userId,
      revision: 1,
    };
    const termsHash = hashTerms(terms);

    // Soft inventory reservation (same point as Protected checkout).
    await prisma.stockListing.update({
      where: { id: listing.id },
      data: {
        saleStatus: "RESERVED",
        inventoryReserved: JSON.stringify({
          buyerId: user.id,
          reservedAt: new Date().toISOString(),
          selectedSize: parsed.data.selectedSize || "",
          paymentOption: storageOption,
        }),
      },
    });

    const txn = await prisma.protectedTransaction.create({
      data: {
        status: "ACCEPTED",
        origin: "PRODUCT_CHECKOUT",
        paymentOption: storageOption,
        buyerId: user.id,
        sellerId: listing.userId,
        listingId: listing.id,
        title: listing.name,
        currency,
        stripeMode: getStripeMode(),
        termsHash,
        termsVersion: 1,
        itemCostMinor: fees.itemCostMinor,
        shippingMinor: fees.shippingMinor,
        sellerServiceFeeMinor: fees.sellerServiceFeeMinor,
        protectionFeeMinor: fees.protectionFeeMinor,
        totalChargeMinor: total,
        selectedSize: parsed.data.selectedSize || "",
        sellerConnectAccountId: connect.stripeAccountId || "",
      },
    });

    await recordAuditEvent({
      protectedTxnId: txn.id,
      actorUserId: user.id,
      action: "PRODUCT_CHECKOUT_CREATED",
      meta: {
        listingId: listing.id,
        paymentOption: storageOption,
        productLabel: isDirect ? "Direct Payment" : "Protected Payment",
      },
    });

    return Response.json(
      {
        ok: true,
        protectedTxnId: txn.id,
        paymentOption: storageOption,
        productLabel: isDirect ? "Direct Payment" : "Protected Payment",
        termsHash,
        amountMinor: total,
        currency,
        breakdown: {
          itemCost: fees.itemCostMinor,
          shipping: fees.shippingMinor,
          sellerServiceFee: fees.sellerServiceFeeMinor,
          platformFee: fees.protectionFeeMinor,
          sourceBridgeProtectionFee: fees.protectionFeeMinor,
          labels: {
            itemCost: "Item Cost",
            shipping: "Shipping",
            sellerServiceFee: "Seller Service Fee",
            platformFee: feeLabel,
            sourceBridgeProtectionFee: feeLabel,
          },
        },
        next: "POST /api/payments/checkout with protectedTxnId",
      },
      { status: 201 },
    );
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Failed";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[payments:product-checkout]", err);
    return jsonError("Product checkout failed", 500);
  }
}

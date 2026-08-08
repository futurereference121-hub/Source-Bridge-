import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import { prisma } from "@/lib/db";
import {
  LISTING_PAYMENT_OPTIONS,
  encodeListingPaymentOptions,
  parseListingPaymentOptions,
} from "@/lib/payments/listing-options";
import { recordAuditEvent } from "@/lib/payments/ledger";

export const runtime = "nodejs";

const patchSchema = z.object({
  listingId: z.string().trim().min(1),
  paymentOptions: z
    .enum(["CONTACT_ONLY", "PROTECTED_ONLY", "INSTANT_ONLY", "BOTH"])
    .optional(),
  protectedPaymentEnabled: z.boolean().optional(),
  directPaymentEnabled: z.boolean().optional(),
});

/** Owner updates listing payment options (server-validated). */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }

    const listing = await prisma.stockListing.findUnique({
      where: { id: parsed.data.listingId },
    });
    if (!listing) return jsonError("Listing not found", 404);
    if (listing.userId !== user.id) return jsonError("Not your listing", 403);

    let next: string;
    if (
      parsed.data.protectedPaymentEnabled !== undefined ||
      parsed.data.directPaymentEnabled !== undefined
    ) {
      try {
        next = encodeListingPaymentOptions({
          protectedPaymentEnabled: Boolean(parsed.data.protectedPaymentEnabled),
          directPaymentEnabled: Boolean(parsed.data.directPaymentEnabled),
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Choose at least one payment option.";
        return jsonError(message, 400);
      }
    } else if (parsed.data.paymentOptions) {
      next = parsed.data.paymentOptions;
    } else {
      return jsonError("paymentOptions required", 400);
    }

    const updated = await prisma.stockListing.update({
      where: { id: listing.id },
      data: { paymentOptions: next },
      select: { id: true, paymentOptions: true, slug: true },
    });

    await recordAuditEvent({
      actorUserId: user.id,
      action: "LISTING_PAYMENT_OPTIONS_UPDATED",
      meta: {
        listingId: listing.id,
        paymentOptions: next,
      },
    });

    return Response.json({
      ok: true,
      listing: updated,
      allowed: LISTING_PAYMENT_OPTIONS,
      parsed: parseListingPaymentOptions(updated.paymentOptions),
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[payments:listing-options]", err);
    return jsonError("Update failed", 500);
  }
}

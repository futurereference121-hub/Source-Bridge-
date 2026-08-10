import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import { prisma } from "@/lib/db";
import { getPlatformPaymentConfig } from "@/lib/payments/config";
import { recordAuditEvent } from "@/lib/payments/ledger";
import {
  getTrackingProvider,
  normalizeTrackingStatus,
} from "@/lib/payments/tracking/provider";
import {
  canTransition,
  nextStatus,
  type ProtectedStatus,
} from "@/lib/payments/state-machine";
import {
  isPaymentsEnabled,
  isProtectedPaymentsEnabled,
  isTrackingAutomationEnabled,
} from "@/lib/payments/flags";
import { assertPaymentsTestAllowlisted } from "@/lib/payments/allowlist";
import { sellerCanAddTracking } from "@/lib/payments/fulfilment";

export const runtime = "nodejs";

const addSchema = z
  .object({
    /** Existing product sales field name. */
    protectedTxnId: z.string().trim().min(1).optional(),
    /** Alias for chat-ticket clients (same ProtectedTransaction id). */
    transactionId: z.string().trim().min(1).optional(),
    trackingNumber: z.string().trim().min(4).max(64),
    carrier: z.string().trim().max(64).optional(),
  })
  .refine((d) => Boolean(d.protectedTxnId || d.transactionId), {
    message: "protectedTxnId or transactionId required",
  });

async function assertTestPartyGate(
  buyerId: string,
  sellerId: string,
  action: string,
) {
  if (!isPaymentsEnabled() || !isProtectedPaymentsEnabled()) {
    throw Object.assign(new Error("Protected Payments are not enabled"), {
      status: 503,
    });
  }
  const buyer = await prisma.user.findUnique({
    where: { id: buyerId },
    select: { id: true, email: true },
  });
  const seller = await prisma.user.findUnique({
    where: { id: sellerId },
    select: { id: true, email: true },
  });
  if (!buyer || !seller) {
    throw Object.assign(new Error("Party not found"), { status: 404 });
  }
  assertPaymentsTestAllowlisted([buyer, seller], {
    action,
    labels: ["buyer", "seller"],
  });
}

/**
 * Seller adds tracking for PRODUCT_CHECKOUT or CHAT_TICKET protected txns.
 * Cannot self-declare DELIVERED. No funds movement.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body = await req.json();
    const parsed = addSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }

    const txnId =
      parsed.data.protectedTxnId || parsed.data.transactionId || "";
    const txn = await prisma.protectedTransaction.findUnique({
      where: { id: txnId },
    });
    if (!txn) return jsonError("Transaction not found", 404);
    if (txn.sellerId !== user.id) {
      return jsonError("Only the seller can add tracking", 403);
    }
    await assertTestPartyGate(txn.buyerId, txn.sellerId, "add tracking");

    // Eligibility: origin-agnostic; procurement-agreed waits for item-fund release.
    if (
      !sellerCanAddTracking({
        paymentOption: txn.paymentOption,
        status: txn.status,
        trackingNumber: txn.trackingNumber,
        procurementAdvanceAgreed: txn.procurementAdvanceAgreed,
        procurementAdvanceMinor: txn.procurementAdvanceMinor,
        procurementTransferredMinor: txn.procurementTransferredMinor,
      })
    ) {
      return jsonError(
        txn.procurementAdvanceAgreed &&
          txn.procurementTransferredMinor === 0 &&
          txn.status === "FUNDED"
          ? "Cannot add tracking until item funds are released"
          : `Cannot add tracking from status ${txn.status}`,
        409,
      );
    }

    const status = txn.status as ProtectedStatus;
    if (!canTransition(status, "ADD_TRACKING")) {
      return jsonError(`Cannot add tracking from status ${status}`, 409);
    }

    const provider = getTrackingProvider();
    let normalized = "LABEL_CREATED";
    let providerStatus = "label_created";

    if (isTrackingAutomationEnabled()) {
      const result = await provider.track(
        parsed.data.trackingNumber,
        parsed.data.carrier || "",
      );
      normalized = result.normalizedStatus;
      providerStatus = result.providerStatus;
      if (normalized === "DELIVERED") {
        normalized = "IN_TRANSIT";
        providerStatus = "in_transit_pending_provider";
      }
    }

    const next = nextStatus(status, "ADD_TRACKING");
    const transitAction =
      normalized === "IN_TRANSIT" || normalized === "OUT_FOR_DELIVERY"
        ? "TRACKING_IN_TRANSIT"
        : null;

    const updated = await prisma.$transaction(async (tx) => {
      let st = next;
      if (transitAction && canTransition(next, transitAction)) {
        st = nextStatus(next, transitAction);
      }
      await tx.trackingEvent.create({
        data: {
          protectedTxnId: txn.id,
          provider: provider.name,
          providerStatus,
          normalizedStatus: normalized,
          rawPayloadJson: JSON.stringify({
            trackingNumber: parsed.data.trackingNumber,
            carrier: parsed.data.carrier || "",
            note: "seller_added",
          }),
          occurredAt: new Date(),
        },
      });
      return tx.protectedTransaction.update({
        where: { id: txn.id },
        data: {
          status: st,
          trackingNumber: parsed.data.trackingNumber,
          trackingCarrier: parsed.data.carrier || "",
          trackingProvider: provider.name,
          trackingStatus: normalized,
          shippedAt: new Date(),
        },
      });
    });

    await recordAuditEvent({
      protectedTxnId: txn.id,
      actorUserId: user.id,
      action: "ADD_TRACKING",
      meta: { trackingNumber: parsed.data.trackingNumber },
    });

    return Response.json({
      ok: true,
      transaction: {
        id: updated.id,
        status: updated.status,
        trackingStatus: updated.trackingStatus,
        trackingNumber: updated.trackingNumber,
        trackingCarrier: updated.trackingCarrier,
        shippedAt: updated.shippedAt?.toISOString() ?? null,
      },
      notice:
        "Delivery confirmation requires tracking provider updates or buyer receipt confirmation. Sellers cannot self-declare delivered.",
    });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Failed";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[payments:tracking]", err);
    return jsonError("Tracking update failed", 500);
  }
}

/** Provider refresh — DELIVERED enters inspection only, no transfer. */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body = (await req.json()) as {
      protectedTxnId?: string;
      transactionId?: string;
    };
    const id = body.protectedTxnId || body.transactionId;
    if (!id) return jsonError("protectedTxnId or transactionId required", 400);

    const txn = await prisma.protectedTransaction.findUnique({
      where: { id },
    });
    if (!txn) return jsonError("Transaction not found", 404);
    if (txn.buyerId !== user.id && txn.sellerId !== user.id) {
      return jsonError("Not a party", 403);
    }
    await assertTestPartyGate(txn.buyerId, txn.sellerId, "refresh tracking");
    if (!txn.trackingNumber) return jsonError("No tracking number", 400);

    const provider = getTrackingProvider();
    const result = await provider.track(txn.trackingNumber, txn.trackingCarrier);
    const normalized = normalizeTrackingStatus(result.providerStatus);

    let status = txn.status as ProtectedStatus;
    const updates: Record<string, unknown> = {
      trackingStatus: normalized,
    };

    if (
      (normalized === "IN_TRANSIT" || normalized === "OUT_FOR_DELIVERY") &&
      canTransition(status, "TRACKING_IN_TRANSIT")
    ) {
      status = nextStatus(status, "TRACKING_IN_TRANSIT");
      updates.status = status;
    }

    if (normalized === "DELIVERED" && canTransition(status, "TRACKING_DELIVERED")) {
      status = nextStatus(status, "TRACKING_DELIVERED");
      const config = await getPlatformPaymentConfig();
      const inspectionEnds = new Date();
      inspectionEnds.setHours(inspectionEnds.getHours() + config.inspectionHours);
      updates.status = nextStatus(status, "START_INSPECTION");
      updates.deliveredAt = new Date();
      updates.trackingDeliveredAt = new Date();
      updates.inspectionEndsAt = inspectionEnds;
    }

    await prisma.trackingEvent.create({
      data: {
        protectedTxnId: txn.id,
        provider: result.provider,
        providerStatus: result.providerStatus,
        normalizedStatus: normalized,
        rawPayloadJson: JSON.stringify(result.raw),
        occurredAt: result.occurredAt,
      },
    });

    const updated = await prisma.protectedTransaction.update({
      where: { id: txn.id },
      data: updates,
    });

    await recordAuditEvent({
      protectedTxnId: txn.id,
      actorUserId: user.id,
      action: "TRACKING_REFRESH",
      meta: { normalizedStatus: normalized, transferTriggered: false },
    });

    return Response.json({
      ok: true,
      normalizedStatus: normalized,
      transaction: {
        id: updated.id,
        status: updated.status,
        trackingStatus: updated.trackingStatus,
        inspectionEndsAt: updated.inspectionEndsAt?.toISOString() ?? null,
      },
    });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Failed";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[payments:tracking:refresh]", err);
    return jsonError("Tracking refresh failed", 500);
  }
}

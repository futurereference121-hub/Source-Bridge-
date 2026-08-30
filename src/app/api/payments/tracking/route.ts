import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import { prisma } from "@/lib/db";
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
import { sellerCanAddTracking, getProtectedOrderForUser } from "@/lib/payments/fulfilment";
import { getOrdersListVersion } from "@/lib/payments/order-list-version";
import { listingProtectedShipmentPhotoRequired } from "@/lib/payments/fulfilment-rules";
import { bumpConversationActivity } from "@/lib/conversation-activity";
import { getPaymentTicket } from "@/lib/payments/tickets";
import { notifyShipmentUpdate } from "@/lib/payment-notifications";

export const runtime = "nodejs";

const addSchema = z
  .object({
    /** Existing product sales field name. */
    protectedTxnId: z.string().trim().min(1).optional(),
    /** Alias for chat-ticket clients (same ProtectedTransaction id). */
    transactionId: z.string().trim().min(1).optional(),
    trackingNumber: z.string().trim().min(4).max(64),
    carrier: z.string().trim().max(64).optional(),
    /** Product listing protected path — proof-of-shipment photo URL. */
    shipmentPhotoUrl: z.string().trim().url().max(2048).optional(),
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
 *
 * Ordering (realtime): DB ship state → activityVersion → notification →
 * canonical mutation response (ticket + activityVersion).
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

    if (
      listingProtectedShipmentPhotoRequired({
        origin: txn.origin,
        paymentOption: txn.paymentOption,
      })
    ) {
      if (!(parsed.data.carrier || "").trim()) {
        return jsonError("Carrier is required for listing shipments", 400, {
          code: "CARRIER_REQUIRED",
        });
      }
      if (!(parsed.data.shipmentPhotoUrl || "").trim()) {
        return jsonError(
          "Shipment photo is required for protected listing sales",
          400,
          { code: "SHIPMENT_PHOTO_REQUIRED" },
        );
      }
    }

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

    const { updated, activityVersion, linkedTicketId } =
      await prisma.$transaction(async (tx) => {
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
              shipmentPhotoUrl: parsed.data.shipmentPhotoUrl || "",
              note: "seller_added",
            }),
            occurredAt: new Date(),
          },
        });
        const row = await tx.protectedTransaction.update({
          where: { id: txn.id },
          data: {
            status: st,
            trackingNumber: parsed.data.trackingNumber,
            trackingCarrier: parsed.data.carrier || "",
            trackingProvider: provider.name,
            trackingStatus: normalized,
            shippedAt: new Date(),
            ...(parsed.data.shipmentPhotoUrl
              ? { shipmentPhotoUrl: parsed.data.shipmentPhotoUrl }
              : {}),
          },
        });

        // Advance ticket activity clocks so client stale-guards accept shipped state.
        await tx.paymentTicket.updateMany({
          where: { protectedTransactionId: txn.id },
          data: { lastMeaningfulActivityAt: new Date() },
        });

        let version = 0;
        if (txn.conversationId) {
          version = await bumpConversationActivity(txn.conversationId, tx, {
            touchLastMessage: true,
          });
        }

        const linked = await tx.paymentTicket.findFirst({
          where: { protectedTransactionId: txn.id },
          select: { id: true },
          orderBy: { updatedAt: "desc" },
        });

        return {
          updated: row,
          activityVersion: version,
          linkedTicketId: linked?.id ?? null,
        };
      });

    await recordAuditEvent({
      protectedTxnId: txn.id,
      actorUserId: user.id,
      action: "ADD_TRACKING",
      meta: { trackingNumber: parsed.data.trackingNumber },
    });

    // Notify only after authoritative state + activityVersion are committed.
    if (txn.conversationId) {
      try {
        await notifyShipmentUpdate({
          protectedTxnId: txn.id,
          conversationId: txn.conversationId,
          buyerId: txn.buyerId,
          sellerId: txn.sellerId,
          trackingNumber: parsed.data.trackingNumber,
          ticketId: linkedTicketId,
          origin: txn.origin,
        });
      } catch (err) {
        console.error("[payments:tracking:notify]", err);
      }
    }

    let ticket = null;
    if (linkedTicketId) {
      try {
        ticket = await getPaymentTicket(linkedTicketId, user.id);
      } catch (err) {
        console.error("[payments:tracking:ticket]", err);
      }
    }

    let order = null;
    let ordersVersion = 0;
    try {
      order = await getProtectedOrderForUser({
        userId: user.id,
        email: user.email,
        protectedTxnId: updated.id,
      });
      ordersVersion = await getOrdersListVersion(user.id, "seller");
    } catch (err) {
      console.error("[payments:tracking:order]", err);
    }

    return Response.json({
      ok: true,
      activityVersion,
      ordersVersion,
      order,
      ticket,
      transaction: {
        id: updated.id,
        status: updated.status,
        trackingStatus: updated.trackingStatus,
        trackingNumber: updated.trackingNumber,
        trackingCarrier: updated.trackingCarrier,
        shipmentPhotoUrl: updated.shipmentPhotoUrl || null,
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
      updates.status = status;
      updates.trackingDeliveredAt = new Date();
      // Carrier delivered ≠ buyer receipt. Do not set deliveredAt or start inspection.
    }

    const { updated, activityVersion } = await prisma.$transaction(
      async (tx) => {
        await tx.trackingEvent.create({
          data: {
            protectedTxnId: txn.id,
            provider: result.provider,
            providerStatus: result.providerStatus,
            normalizedStatus: normalized,
            rawPayloadJson: JSON.stringify(result.raw),
            occurredAt: result.occurredAt,
          },
        });

        const row = await tx.protectedTransaction.update({
          where: { id: txn.id },
          data: updates,
        });

        let version = 0;
        if (txn.conversationId && updates.status) {
          version = await bumpConversationActivity(txn.conversationId, tx, {
            touchLastMessage: true,
          });
        }

        return { updated: row, activityVersion: version };
      },
    );

    await recordAuditEvent({
      protectedTxnId: txn.id,
      actorUserId: user.id,
      action: "TRACKING_REFRESH",
      meta: { normalizedStatus: normalized, transferTriggered: false },
    });

    return Response.json({
      ok: true,
      activityVersion,
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

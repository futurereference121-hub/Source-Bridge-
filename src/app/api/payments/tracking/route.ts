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
import { isTrackingAutomationEnabled } from "@/lib/payments/flags";

export const runtime = "nodejs";

const addSchema = z.object({
  protectedTxnId: z.string().trim().min(1),
  trackingNumber: z.string().trim().min(4).max(64),
  carrier: z.string().trim().max(64).optional(),
});

/**
 * Seller adds tracking. Cannot self-declare DELIVERED for tracked shipments —
 * delivery comes from provider (or mock) / admin only.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body = await req.json();
    const parsed = addSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }

    const txn = await prisma.protectedTransaction.findUnique({
      where: { id: parsed.data.protectedTxnId },
    });
    if (!txn) return jsonError("Transaction not found", 404);
    if (txn.sellerId !== user.id) {
      return jsonError("Only the seller can add tracking", 403);
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
      // Seller path: never accept DELIVERED from this endpoint even if mock returns it
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
      },
      notice:
        "Delivery confirmation requires tracking provider updates. Sellers cannot self-declare delivered on tracked shipments.",
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

/** Provider/webhook-style refresh — marks DELIVERED only via provider normalize. */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body = (await req.json()) as { protectedTxnId?: string };
    if (!body.protectedTxnId) return jsonError("protectedTxnId required", 400);

    const txn = await prisma.protectedTransaction.findUnique({
      where: { id: body.protectedTxnId },
    });
    if (!txn) return jsonError("Transaction not found", 404);
    if (txn.buyerId !== user.id && txn.sellerId !== user.id) {
      return jsonError("Not a party", 403);
    }
    if (!txn.trackingNumber) return jsonError("No tracking number", 400);

    const provider = getTrackingProvider();
    const result = await provider.track(txn.trackingNumber, txn.trackingCarrier);
    const normalized = normalizeTrackingStatus(result.providerStatus);

    // Sellers refreshing cannot force DELIVERED — only provider result can.
    // (Mock ending in 9 simulates provider delivery.)
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
      meta: { normalizedStatus: normalized },
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

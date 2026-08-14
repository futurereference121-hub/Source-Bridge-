import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import { prisma } from "@/lib/db";
import { createOrRevisePaymentTicket } from "@/lib/payments/tickets";
import { isProtectedPaymentsEnabled, isInstantPaymentsEnabled } from "@/lib/payments/flags";
import { assignConversationTicketRoles } from "@/lib/payments/ticket-lifecycle";

export const runtime = "nodejs";

const createSchema = z.object({
  conversationId: z.string().trim().min(1),
  /** Required: explicit Buyer. Sourcer is the other conversation participant. */
  buyerId: z.string().trim().min(1, "Select who is buying"),
  sellerId: z.string().trim().min(1).optional(),
  itemCostMinor: z.number().int().nonnegative(),
  shippingMinor: z.number().int().nonnegative().optional(),
  sellerServiceFeeMinor: z.number().int().nonnegative().optional(),
  title: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  paymentOption: z.enum(["PROTECTED", "INSTANT"]).optional(),
  procurementAdvanceAgreed: z.boolean().optional(),
  listingId: z.string().trim().nullable().optional(),
  currency: z.string().trim().length(3).optional(),
  proposalTraceId: z.string().trim().max(80).optional(),
  /** Edit path: supersede this ticket only (multi-ticket conversations). */
  reviseFromTicketId: z.string().trim().min(1).optional(),
});

function readProposalTraceId(req: NextRequest, body: { proposalTraceId?: string }) {
  const header = (req.headers.get("x-proposal-trace-id") || "").trim();
  const fromBody = (body.proposalTraceId || "").trim();
  return (header || fromBody || "").slice(0, 80) || null;
}

export async function POST(req: NextRequest) {
  let proposalTraceId: string | null = null;
  let conversationIdForLog: string | null = null;
  try {
    const user = await requireSessionUser();
    if (!isProtectedPaymentsEnabled() && !isInstantPaymentsEnabled()) {
      return jsonError("Protected Payments are not enabled", 503, {
        ok: false,
        code: "PAYMENTS_DISABLED",
      });
    }

    const body = await req.json();
    proposalTraceId = readProposalTraceId(req, body);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400, {
        ok: false,
        code: "VALIDATION",
        ...(proposalTraceId ? { proposalTraceId } : {}),
      });
    }
    const data = parsed.data;
    conversationIdForLog = data.conversationId;
    // Never invent conversationId — require from body only.
    if (!data.conversationId) {
      return jsonError("conversationId is required", 400, {
        ok: false,
        code: "VALIDATION",
        ...(proposalTraceId ? { proposalTraceId } : {}),
      });
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: data.conversationId },
      include: { participants: true },
    });
    if (!conversation) {
      return jsonError("Conversation not found", 404, {
        ok: false,
        ...(proposalTraceId ? { proposalTraceId } : {}),
      });
    }
    const parts = conversation.participants.filter((p) => !p.leftAt);
    if (!parts.some((p) => p.userId === user.id)) {
      return jsonError("Not a participant", 403, {
        ok: false,
        ...(proposalTraceId ? { proposalTraceId } : {}),
      });
    }
    const other = parts.find((p) => p.userId !== user.id);
    if (!other) {
      return jsonError("Conversation needs two parties", 400, {
        ok: false,
        ...(proposalTraceId ? { proposalTraceId } : {}),
      });
    }

    // Explicit Buyer selection is required. Sourcer is always the other
    // conversation participant — never inferred from proposer identity.
    const roles = assignConversationTicketRoles({
      participantIds: parts.map((p) => p.userId),
      buyerId: data.buyerId,
      proposedSellerId: data.sellerId,
    });
    if (!roles.ok) {
      return jsonError(roles.message, 400, {
        ok: false,
        code: roles.code,
        ...(proposalTraceId ? { proposalTraceId } : {}),
      });
    }
    const buyerId = roles.buyerId;
    const sellerId = roles.sellerId;

    let ticket;
    let message;
    try {
      ({ ticket, message } = await createOrRevisePaymentTicket({
        conversationId: data.conversationId,
        actorId: user.id,
        buyerId,
        sellerId,
        amounts: {
          itemCostMinor: data.itemCostMinor,
          shippingMinor: data.shippingMinor,
          sellerServiceFeeMinor: data.sellerServiceFeeMinor,
          title: data.title,
          notes: data.notes,
          paymentOption: data.paymentOption,
          procurementAdvanceAgreed: data.procurementAdvanceAgreed,
          listingId: data.listingId,
          currency: data.currency,
        },
        reviseFromTicketId: data.reviseFromTicketId ?? null,
      }));
    } catch (inner) {
      // Attach conversationId + peer for safe denial logs below.
      throw Object.assign(inner instanceof Error ? inner : new Error("Failed"), {
        conversationId: data.conversationId,
        peerId: other.userId,
        status: (inner as { status?: number })?.status,
        code: (inner as { code?: string })?.code,
        allowlistParty: (inner as { allowlistParty?: string })?.allowlistParty,
      });
    }

    // Success path always includes ticket; message may be null (client can
    // synthesize a timeline row). SAFE: ids only, no secrets / amounts.
    console.info("[payments:tickets:create] ok", {
      proposalTraceId,
      conversationId: data.conversationId,
      ticketId: ticket.id,
      messageId: message?.id ?? null,
      actorId: user.id,
      peerId: other.userId,
      buyerId,
      sellerId,
      status: ticket.status,
      sourcingRequestId: ticket.sourcingRequestId ?? null,
    });

    return Response.json(
      {
        ok: true,
        ticket,
        message,
        timelineEvent: message,
        ...(proposalTraceId ? { proposalTraceId } : {}),
      },
      {
        status: 201,
        headers: {
          "Cache-Control": "no-store",
          ...(proposalTraceId
            ? { "x-proposal-trace-id": proposalTraceId }
            : {}),
        },
      },
    );
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const code = (err as { code?: string }).code;
    const allowlistParty = (err as { allowlistParty?: string }).allowlistParty;
    const message = err instanceof Error ? err.message : "Failed";
    const peerId =
      typeof (err as { peerId?: string }).peerId === "string"
        ? (err as { peerId?: string }).peerId
        : null;
    const conversationId =
      typeof (err as { conversationId?: string }).conversationId === "string"
        ? (err as { conversationId?: string }).conversationId
        : conversationIdForLog;
    if (status === 401) {
      return jsonError("Sign in required", 401, {
        ok: false,
        ...(proposalTraceId ? { proposalTraceId } : {}),
      });
    }
    // Preserve client-facing errors: 403 allowlist, 400 validation, 409 races, 503 disabled.
    if ((status >= 400 && status < 500) || status === 503) {
      // SAFE diagnosis — no secrets, amounts, or allowlist contents.
      console.info("[payments:tickets:create] denied", {
        proposalTraceId,
        status,
        code: code ?? null,
        allowlistParty: allowlistParty ?? null,
        conversationId,
        peerId,
      });
      return jsonError(message, status, {
        ok: false,
        ...(code ? { code } : {}),
        ...(allowlistParty ? { allowlistParty } : {}),
        ...(proposalTraceId ? { proposalTraceId } : {}),
      });
    }
    console.error("[payments:tickets:create]", {
      proposalTraceId,
      conversationId,
      err,
    });
    return jsonError("Failed to create Payment Ticket", 500, {
      ok: false,
      ...(proposalTraceId ? { proposalTraceId } : {}),
    });
  }
}

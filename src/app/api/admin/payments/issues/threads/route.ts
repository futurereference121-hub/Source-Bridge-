import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import {
  getOrCreateAdminDisputeThread,
  listAdminDisputeThreads,
  sendAdminDisputeMessage,
  type AdminDisputePartyRole,
} from "@/lib/payments/admin-dispute-threads";

export const runtime = "nodejs";

const createSchema = z.object({
  disputeId: z.string().trim().min(1),
  role: z.enum(["BUYER", "SELLER"]),
  body: z.string().trim().max(4000).optional(),
});

function mapThread(
  c: Awaited<ReturnType<typeof listAdminDisputeThreads>>[number],
) {
  return {
    id: c.id,
    adminPartyRole: c.adminPartyRole,
    disputeCaseId: c.disputeCaseId,
    paymentTicketId: c.paymentTicketId,
    subject: c.subject,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    participants: c.participants.map((p) => ({
      userId: p.userId,
      user: p.user
        ? {
            id: p.user.id,
            name: p.user.name,
            username: p.user.username,
          }
        : null,
    })),
    messages: c.messages.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      sender: m.sender
        ? {
            id: m.sender.id,
            name: m.sender.name,
            username: m.sender.username,
          }
        : null,
    })),
  };
}

/** List private Admin↔Buyer and Admin↔Sourcer threads for a dispute. */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const disputeId = req.nextUrl.searchParams.get("disputeId") || "";
    if (!disputeId) return jsonError("disputeId required", 400);
    const threads = await listAdminDisputeThreads(disputeId);
    return Response.json({
      ok: true,
      threads: threads.map(mapThread),
    });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    if (status === 401) return jsonError("Sign in required", 401);
    if (status === 403) return jsonError("Admin only", 403);
    console.error("[admin:dispute-threads:list]", err);
    return jsonError("Failed to load admin threads", 500);
  }
}

/** Open or message a private Admin↔party thread (never the party chat). */
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }

    const { conversation, created, partyId } =
      await getOrCreateAdminDisputeThread({
        adminUserId: admin.id,
        disputeCaseId: parsed.data.disputeId,
        role: parsed.data.role as AdminDisputePartyRole,
      });

    let message = null;
    if (parsed.data.body?.trim()) {
      const sent = await sendAdminDisputeMessage({
        adminUserId: admin.id,
        conversationId: conversation.id,
        body: parsed.data.body,
      });
      message = {
        id: sent.message.id,
        body: sent.message.body,
        createdAt: sent.message.createdAt.toISOString(),
      };
    }

    return Response.json({
      ok: true,
      created,
      partyId,
      conversationId: conversation.id,
      role: parsed.data.role,
      disputeCaseId: parsed.data.disputeId,
      paymentTicketId: conversation.paymentTicketId,
      message,
    });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Failed";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status === 403) return jsonError("Admin only", 403);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[admin:dispute-threads:post]", err);
    return jsonError("Failed to open admin thread", 500);
  }
}

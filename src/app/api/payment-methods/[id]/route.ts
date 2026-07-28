import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { jsonError, patchPaymentMethodSchema } from "@/lib/validation";
import { deleteStoredImageForUser } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

function mapPaymentMethod(row: {
  id: string;
  kind: string;
  networkName: string;
  address: string;
  qrImageUrl: string;
  instructions: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    kind: row.kind,
    networkName: row.networkName,
    address: row.address,
    qrImageUrl: row.qrImageUrl,
    instructions: row.instructions,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireSessionUser();
    const { id } = await ctx.params;
    const existing = await prisma.sellerPaymentMethod.findUnique({
      where: { id },
    });
    if (!existing || existing.userId !== user.id) {
      return jsonError("Payment method not found", 404);
    }

    const body = await req.json();
    const parsed = patchPaymentMethodSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }
    const data = parsed.data;

    const prevQr = existing.qrImageUrl;
    const nextQr =
      data.qrImageUrl !== undefined ? data.qrImageUrl : existing.qrImageUrl;

    const row = await prisma.sellerPaymentMethod.update({
      where: { id },
      data: {
        ...(data.networkName !== undefined
          ? { networkName: data.networkName }
          : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(data.qrImageUrl !== undefined
          ? { qrImageUrl: data.qrImageUrl }
          : {}),
        ...(data.instructions !== undefined
          ? { instructions: data.instructions }
          : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      },
    });

    if (prevQr && nextQr !== prevQr) {
      try {
        await deleteStoredImageForUser(prevQr, user.id);
      } catch (err) {
        console.error("[payment-methods:patch:blob]", err);
      }
    }

    return Response.json({ ok: true, paymentMethod: mapPaymentMethod(row) });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[payment-methods:patch]", err);
    return jsonError("Update failed", 500);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireSessionUser();
    const { id } = await ctx.params;
    const existing = await prisma.sellerPaymentMethod.findUnique({
      where: { id },
    });
    if (!existing || existing.userId !== user.id) {
      return jsonError("Payment method not found", 404);
    }

    await prisma.sellerPaymentMethod.delete({ where: { id } });

    if (existing.qrImageUrl) {
      try {
        await deleteStoredImageForUser(existing.qrImageUrl, user.id);
      } catch (err) {
        console.error("[payment-methods:delete:blob]", err);
      }
    }

    return Response.json({ ok: true });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[payment-methods:delete]", err);
    return jsonError("Delete failed", 500);
  }
}

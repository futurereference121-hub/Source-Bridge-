import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { createPaymentMethodSchema, jsonError } from "@/lib/validation";

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

export async function GET() {
  try {
    const user = await requireSessionUser();
    const rows = await prisma.sellerPaymentMethod.findMany({
      where: { userId: user.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return Response.json({ paymentMethods: rows.map(mapPaymentMethod) });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[payment-methods:list]", err);
    return jsonError("Failed to load payment methods", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (!user.emailVerified) return jsonError("Verify email first", 403);
    if (!user.onboardingComplete) {
      return jsonError("Complete your profile first", 403);
    }

    const body = await req.json();
    const parsed = createPaymentMethodSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }

    const count = await prisma.sellerPaymentMethod.count({
      where: { userId: user.id },
    });

    const row = await prisma.sellerPaymentMethod.create({
      data: {
        userId: user.id,
        kind: parsed.data.kind,
        networkName: parsed.data.networkName,
        address: parsed.data.address,
        qrImageUrl: parsed.data.qrImageUrl || "",
        instructions: parsed.data.instructions || "",
        enabled: parsed.data.enabled ?? true,
        sortOrder: count,
      },
    });

    return Response.json(
      { ok: true, paymentMethod: mapPaymentMethod(row) },
      { status: 201 },
    );
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[payment-methods:create]", err);
    return jsonError("Could not create payment method", 500);
  }
}

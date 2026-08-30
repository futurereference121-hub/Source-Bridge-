import { prisma } from "@/lib/db";

export type ProtectedOrderListRole = "buyer" | "seller";

export async function getOrdersListVersion(
  userId: string,
  role: ProtectedOrderListRole,
): Promise<number> {
  const where =
    role === "seller" ? { sellerId: userId } : { buyerId: userId };
  const agg = await prisma.protectedTransaction.aggregate({
    where,
    _max: { updatedAt: true },
  });
  return agg._max.updatedAt?.getTime() ?? 0;
}

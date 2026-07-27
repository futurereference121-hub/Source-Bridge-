import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { jsonError, networkLocationSchema } from "@/lib/validation";
import { z } from "zod";

export async function GET() {
  try {
    const user = await requireSessionUser();
    const rows = await prisma.networkLocation.findMany({
      where: { userId: user.id },
      orderBy: { sortOrder: "asc" },
    });
    return Response.json({ network: rows });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    return jsonError("Failed to load network", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body = await req.json();
    const parsed = networkLocationSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid location", 400);
    }
    const max = await prisma.networkLocation.aggregate({
      where: { userId: user.id },
      _max: { sortOrder: true },
    });
    const row = await prisma.networkLocation.create({
      data: {
        userId: user.id,
        city: parsed.data.city,
        country: parsed.data.country,
        sortOrder: (max._max.sortOrder ?? -1) + 1,
      },
    });
    return Response.json({ ok: true, location: row });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    return jsonError("Could not add location", 500);
  }
}

const reorderSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
});

export async function PUT(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body = await req.json();

    if (body.action === "reorder") {
      const parsed = reorderSchema.safeParse(body);
      if (!parsed.success) return jsonError("orderedIds required", 400);
      const owned = await prisma.networkLocation.findMany({
        where: { userId: user.id },
        select: { id: true },
      });
      const ownedIds = new Set(owned.map((o) => o.id));
      for (const id of parsed.data.orderedIds) {
        if (!ownedIds.has(id)) return jsonError("Invalid location id", 400);
      }
      await prisma.$transaction(
        parsed.data.orderedIds.map((id, i) =>
          prisma.networkLocation.update({
            where: { id },
            data: { sortOrder: i },
          }),
        ),
      );
      const rows = await prisma.networkLocation.findMany({
        where: { userId: user.id },
        orderBy: { sortOrder: "asc" },
      });
      return Response.json({ ok: true, network: rows });
    }

    return jsonError("Unknown action", 400);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    return jsonError("Reorder failed", 500);
  }
}

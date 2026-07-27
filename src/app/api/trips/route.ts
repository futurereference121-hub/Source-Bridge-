import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { jsonError, tripSchema } from "@/lib/validation";

export async function GET() {
  try {
    const user = await requireSessionUser();
    const trips = await prisma.trip.findMany({
      where: { userId: user.id },
      orderBy: { arrival: "asc" },
    });
    return Response.json({ trips });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    return jsonError("Failed to load trips", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body = await req.json();
    const parsed = tripSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid trip", 400);
    }
    const trip = await prisma.trip.create({
      data: { userId: user.id, ...parsed.data },
    });
    return Response.json({ ok: true, trip });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    return jsonError("Could not add trip", 500);
  }
}

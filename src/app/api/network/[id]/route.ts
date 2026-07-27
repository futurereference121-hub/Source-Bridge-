import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { jsonError, networkLocationSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireSessionUser();
    const { id } = await ctx.params;
    const existing = await prisma.networkLocation.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      return jsonError("Not found", 404);
    }
    const body = await req.json();
    const parsed = networkLocationSchema.partial().safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }
    const row = await prisma.networkLocation.update({
      where: { id },
      data: parsed.data,
    });
    return Response.json({ ok: true, location: row });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    return jsonError("Update failed", 500);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireSessionUser();
    const { id } = await ctx.params;
    const existing = await prisma.networkLocation.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      return jsonError("Not found", 404);
    }
    await prisma.networkLocation.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    return jsonError("Delete failed", 500);
  }
}

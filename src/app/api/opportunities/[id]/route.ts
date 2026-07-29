import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { jsonError, opportunitySchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireSessionUser();
    const { id } = await ctx.params;
    const existing = await prisma.opportunity.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      return jsonError("Opportunity not found", 404);
    }

    const body = await req.json();

    if (body.action === "close") {
      const row = await prisma.opportunity.update({
        where: { id },
        data: { closedAt: new Date() },
      });
      return Response.json({ ok: true, opportunity: row });
    }

    const parsed = opportunitySchema.partial().safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }
    const data = parsed.data;

    const row = await prisma.opportunity.update({
      where: { id },
      data: {
        ...(data.title !== undefined && data.title.trim()
          ? { title: data.title.trim() }
          : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.city !== undefined ? { city: data.city } : {}),
        ...(data.country !== undefined ? { country: data.country } : {}),
        ...(data.category !== undefined && data.category.trim()
          ? { category: data.category.trim() }
          : {}),
        ...(data.startsAt !== undefined
          ? { startsAt: data.startsAt ? new Date(data.startsAt) : null }
          : {}),
        ...(data.expiresAt !== undefined
          ? {
              expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
            }
          : {}),
      },
    });

    return Response.json({ ok: true, opportunity: row });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[opportunity:patch]", err);
    return jsonError("Update failed", 500);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireSessionUser();
    const { id } = await ctx.params;
    const existing = await prisma.opportunity.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      return jsonError("Opportunity not found", 404);
    }
    await prisma.opportunity.update({
      where: { id },
      data: { closedAt: new Date() },
    });
    return Response.json({ ok: true });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    return jsonError("Close failed", 500);
  }
}

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { jsonError, opportunitySchema } from "@/lib/validation";
import { revalidatePath } from "next/cache";
import {
  mapOpportunityPublic,
  resolveLifecycle,
} from "@/lib/opportunities/map";
import {
  canTransitionLifecycle,
  isTerminalLifecycle,
  type OpportunityLifecycle,
} from "@/lib/opportunities/lifecycle";
import { opportunityLifecycleActionSchema } from "@/lib/opportunities/validation";
import {
  BUYER_REQUEST_DEFAULT_DAYS,
  SOURCING_OFFER_DEFAULT_DAYS,
  computeOpportunityExpiresAt,
} from "@/lib/opportunities/expiry";
import { isCreatableOpportunityKind } from "@/lib/opportunities/kinds";
import { findByClientRequestId } from "@/lib/opportunities/create";

type Ctx = { params: Promise<{ id: string }> };

function revalidateOppSurfaces() {
  revalidatePath("/activity");
  revalidatePath("/explore");
  revalidatePath("/opportunities");
  revalidatePath("/api/feed");
}

/**
 * Authenticated full Opportunity detail.
 * Logged-out clients receive 401 — compact teasers use marketplace/feed summaries only.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    await requireSessionUser();
    const { id } = await ctx.params;
    const row = await prisma.opportunity.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            name: true,
            slug: true,
            photo: true,
          },
        },
      },
    });
    if (!row) return jsonError("Opportunity not found", 404);
    return Response.json({ opportunity: mapOpportunityPublic(row) });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[opportunity:get]", err);
    return jsonError("Failed to load opportunity", 500);
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireSessionUser();
    const { id } = await ctx.params;
    const existing = await prisma.opportunity.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      return jsonError("Opportunity not found", 404);
    }

    const body = await req.json();
    const now = new Date();
    const current = resolveLifecycle(existing, now);

    // Legacy close action
    if (body.action === "close") {
      if (isTerminalLifecycle(current) && current !== "EXPIRED") {
        return jsonError("Opportunity already closed", 400);
      }
      const row = await prisma.opportunity.update({
        where: { id },
        data: {
          closedAt: now,
          lifecycle: "WITHDRAWN",
          stateChangedAt: now,
        },
      });
      revalidateOppSurfaces();
      return Response.json({ ok: true, opportunity: mapOpportunityPublic(row) });
    }

    const actionParsed = opportunityLifecycleActionSchema.safeParse(body);
    if (actionParsed.success) {
      const { action, renewUntil, clientRequestId } = actionParsed.data;

      if (action === "renew") {
        if (clientRequestId) {
          const prior = await findByClientRequestId(user.id, clientRequestId);
          if (prior) {
            return Response.json({
              ok: true,
              opportunity: mapOpportunityPublic(prior),
              idempotent: true,
            });
          }
        }

        let newExpires: Date;
        if (renewUntil) {
          newExpires = new Date(renewUntil);
        } else if (
          existing.kind === "TRAVEL_OPPORTUNITY" &&
          existing.travelEndAt
        ) {
          newExpires = existing.travelEndAt;
        } else if (isCreatableOpportunityKind(existing.kind)) {
          newExpires = computeOpportunityExpiresAt({
            kind: existing.kind,
            now,
            deadline: null,
            availabilityEndsAt: null,
            travelEndAt: existing.travelEndAt,
          });
        } else {
          newExpires = new Date(
            now.getTime() + BUYER_REQUEST_DEFAULT_DAYS * 24 * 60 * 60 * 1000,
          );
        }

        // Explicit renew: reopen from terminal EXPIRED/WITHDRAWN with new period.
        // FULFILLED cannot renew — preserve history.
        if (current === "FULFILLED") {
          return jsonError("Fulfilled opportunities cannot be renewed", 400);
        }
        if (
          current !== "EXPIRED" &&
          current !== "WITHDRAWN" &&
          current !== "OPEN" &&
          current !== "IN_DISCUSSION" &&
          current !== "MATCHED"
        ) {
          return jsonError("Cannot renew this opportunity", 400);
        }

        // Default renew windows when travel end already passed
        if (
          existing.kind === "TRAVEL_OPPORTUNITY" &&
          newExpires.getTime() <= now.getTime()
        ) {
          newExpires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        }
        if (
          existing.kind === "SOURCING_OFFER" &&
          !renewUntil &&
          newExpires.getTime() <= now.getTime()
        ) {
          newExpires = new Date(
            now.getTime() + SOURCING_OFFER_DEFAULT_DAYS * 24 * 60 * 60 * 1000,
          );
        }

        const row = await prisma.opportunity.update({
          where: { id },
          data: {
            lifecycle: "OPEN",
            closedAt: null,
            expiresAt: newExpires,
            stateChangedAt: now,
            renewCount: { increment: 1 },
            preExpiryNotifiedAt: null,
            clientRequestId: clientRequestId || existing.clientRequestId,
          },
        });
        revalidateOppSurfaces();
        return Response.json({ ok: true, opportunity: mapOpportunityPublic(row) });
      }

      const targetMap: Record<string, OpportunityLifecycle> = {
        withdraw: "WITHDRAWN",
        mark_matched: "MATCHED",
        mark_fulfilled: "FULFILLED",
        mark_in_discussion: "IN_DISCUSSION",
        reopen_discussion: "IN_DISCUSSION",
      };
      const target = targetMap[action];
      if (!target || !canTransitionLifecycle(current, target)) {
        return jsonError(
          `Cannot move from ${current} to ${target || action}`,
          400,
        );
      }

      const row = await prisma.opportunity.update({
        where: { id },
        data: {
          lifecycle: target,
          stateChangedAt: now,
          ...(target === "WITHDRAWN" ? { closedAt: now } : {}),
          ...(target === "FULFILLED" ? { closedAt: now } : {}),
        },
      });
      revalidateOppSurfaces();
      return Response.json({ ok: true, opportunity: mapOpportunityPublic(row) });
    }

    // Field edits — do not rewrite message snapshots; block terminal resurrect via edit.
    if (isTerminalLifecycle(current)) {
      return jsonError(
        "Closed opportunities cannot be edited. Renew to reopen.",
        400,
      );
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

    revalidateOppSurfaces();
    return Response.json({ ok: true, opportunity: mapOpportunityPublic(row) });
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
    const now = new Date();
    await prisma.opportunity.update({
      where: { id },
      data: {
        closedAt: now,
        lifecycle: "WITHDRAWN",
        stateChangedAt: now,
      },
    });
    revalidateOppSurfaces();
    return Response.json({ ok: true });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    return jsonError("Close failed", 500);
  }
}

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireSessionUser } from "@/lib/auth";
import {
  jsonError,
  onboardingHelpSchema,
  onboardingIdentitySchema,
  onboardingLocationSchema,
  slugFromUsername,
} from "@/lib/validation";
import { isUsernameAvailable } from "@/lib/members-service";
import { assertDailyLimit, recordDailyAction } from "@/lib/rate-limit";
import { STATUS_TTL_MS } from "@/lib/limits";
import { listCategoryNames } from "@/lib/categories-db";

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (!user.emailVerified) {
      return jsonError("Verify your email before onboarding", 403);
    }

    const body = await req.json();
    const step = body.step as string;

    if (step === "identity") {
      const parsed = onboardingIdentitySchema.safeParse(body);
      if (!parsed.success) {
        return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
      }
      const data = parsed.data;
      const available = await isUsernameAvailable(data.username, user.id);
      if (!available) return jsonError("Username is taken", 409);

      const updated = await prisma.user.update({
        where: { id: user.id },
        data: {
          username: data.username,
          slug: slugFromUsername(data.username),
          name: data.fullName,
          bio: data.bio || "",
          photo: data.photo || "",
          cover: data.cover || "",
        },
      });
      return Response.json({ ok: true, step: "identity", userId: updated.id });
    }

    if (step === "location") {
      const parsed = onboardingLocationSchema.safeParse(body);
      if (!parsed.success) {
        return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
      }
      const data = parsed.data;

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { city: data.city, country: data.country },
        });
        await tx.networkLocation.deleteMany({ where: { userId: user.id } });
        if (data.network.length) {
          await tx.networkLocation.createMany({
            data: data.network.map((n, i) => ({
              userId: user.id,
              city: n.city,
              country: n.country,
              sortOrder: i,
            })),
          });
        }
        if (data.trips.length) {
          await tx.trip.deleteMany({ where: { userId: user.id } });
          await tx.trip.createMany({
            data: data.trips.map((t) => ({
              userId: user.id,
              city: t.city,
              country: t.country,
              arrival: t.arrival,
              departure: t.departure,
            })),
          });
        }
      });

      return Response.json({ ok: true, step: "location" });
    }

    if (step === "help") {
      const parsed = onboardingHelpSchema.safeParse(body);
      if (!parsed.success) {
        return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
      }
      const data = parsed.data;
      const allowed = await listCategoryNames();
      const allowedSet = new Set(allowed.map((c) => c.toLowerCase()));
      for (const s of data.specialties) {
        if (!allowedSet.has(s.toLowerCase())) {
          return jsonError(`Unknown category: ${s}`, 400);
        }
      }

      // Require identity basics before completing
      const current = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      if (!current.username || !current.slug) {
        return jsonError("Complete identity step first", 400);
      }
      if (!current.city || !current.country) {
        return jsonError("Complete location step first", 400);
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          specialties: JSON.stringify(data.specialties),
          publicDisplayMessage: data.publicDisplayMessage || "",
          onboardingComplete: true,
        },
      });

      if (data.statusText?.trim()) {
        await assertDailyLimit(user.id, "status");
        const now = new Date();
        await prisma.statusUpdate.create({
          data: {
            userId: user.id,
            text: data.statusText.trim(),
            postedAt: now,
            expiresAt: new Date(now.getTime() + STATUS_TTL_MS),
          },
        });
        await recordDailyAction(user.id, "status", now);
      }

      if (data.opportunity) {
        const catOk = allowedSet.has(data.opportunity.category.toLowerCase());
        if (!catOk) return jsonError("Unknown opportunity category", 400);
        await assertDailyLimit(user.id, "opportunity");
        await prisma.opportunity.create({
          data: {
            userId: user.id,
            title: data.opportunity.title,
            description: data.opportunity.description,
            city: data.opportunity.city,
            country: data.opportunity.country,
            category: data.opportunity.category,
            expiresAt: data.opportunity.expiresAt
              ? new Date(data.opportunity.expiresAt)
              : null,
          },
        });
        await recordDailyAction(user.id, "opportunity");
      }

      return Response.json({
        ok: true,
        step: "help",
        complete: true,
        next: "/profile",
        message: "Your Source Bridge profile is ready.",
      });
    }

    return jsonError("Unknown onboarding step", 400);
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Onboarding failed";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status === 429) return jsonError(message, 429);
    console.error("[onboarding]", err);
    return jsonError(message, status >= 400 && status < 600 ? status : 500);
  }
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError("Sign in required", 401);
  return Response.json({
    emailVerified: user.emailVerified,
    onboardingComplete: user.onboardingComplete,
    username: user.username,
    city: user.city,
    country: user.country,
  });
}

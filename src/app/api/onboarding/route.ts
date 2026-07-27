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
import { assertDailyLimit } from "@/lib/rate-limit";
import { calendarDayKey, STATUS_TTL_MS } from "@/lib/limits";
import { listCategoryNames } from "@/lib/categories-db";
import { pathnameBelongsToUser } from "@/lib/storage";

function isAllowedProfileImageUrl(url: string, userId: string): boolean {
  if (!url || !url.trim()) return true;
  const value = url.trim();
  try {
    if (value.startsWith("https://")) {
      const parsed = new URL(value);
      const hostOk =
        parsed.hostname.endsWith(".public.blob.vercel-storage.com") ||
        parsed.hostname.endsWith(".blob.vercel-storage.com");
      if (!hostOk) return false;
      return pathnameBelongsToUser(parsed.pathname, userId);
    }
  } catch {
    return false;
  }
  const cleaned = value.replace(/^\//, "");
  if (cleaned.startsWith("uploads/")) {
    return pathnameBelongsToUser(cleaned.slice("uploads/".length), userId);
  }
  return false;
}

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
      if (
        !isAllowedProfileImageUrl(data.photo || "", user.id) ||
        !isAllowedProfileImageUrl(data.cover || "", user.id)
      ) {
        return jsonError("Invalid image URL for this account", 400);
      }
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

      const current = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });

      // Idempotent: already completed → do not republish status/opportunities.
      if (current.onboardingComplete && current.slug) {
        return Response.json({
          ok: true,
          step: "help",
          complete: true,
          slug: current.slug,
          next: `/members/${current.slug}?welcome=1`,
          message: "Your Source Bridge profile is ready.",
        });
      }

      if (!current.username || !current.slug) {
        return jsonError("Complete identity step first", 400);
      }
      if (!current.city || !current.country) {
        return jsonError("Complete location step first", 400);
      }

      const statusText = data.statusText?.trim() || "";
      if (data.opportunity) {
        const catOk = allowedSet.has(data.opportunity.category.toLowerCase());
        if (!catOk) return jsonError("Unknown opportunity category", 400);
      }

      // Pre-check daily limits before the completion transaction.
      if (statusText) await assertDailyLimit(user.id, "status");
      if (data.opportunity) await assertDailyLimit(user.id, "opportunity");

      const now = new Date();
      const dayKey = calendarDayKey(now);
      const completed = await prisma.$transaction(async (tx) => {
        const fresh = await tx.user.findUniqueOrThrow({
          where: { id: user.id },
        });
        if (fresh.onboardingComplete && fresh.slug) {
          return { slug: fresh.slug, alreadyComplete: true as const };
        }
        if (!fresh.username || !fresh.slug) {
          throw Object.assign(new Error("Complete identity step first"), {
            status: 400,
          });
        }
        if (!fresh.city || !fresh.country) {
          throw Object.assign(new Error("Complete location step first"), {
            status: 400,
          });
        }

        await tx.user.update({
          where: { id: user.id },
          data: {
            specialties: JSON.stringify(data.specialties),
            publicDisplayMessage: data.publicDisplayMessage || "",
            onboardingComplete: true,
          },
        });

        // Publish optional onboarding status/opportunity only with completion.
        if (statusText) {
          await tx.statusUpdate.create({
            data: {
              userId: user.id,
              text: statusText,
              postedAt: now,
              expiresAt: new Date(now.getTime() + STATUS_TTL_MS),
            },
          });
          await tx.rateLimitEvent.create({
            data: { userId: user.id, action: "status", dayKey },
          });
        }

        if (data.opportunity) {
          await tx.opportunity.create({
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
              postedAt: now,
            },
          });
          await tx.rateLimitEvent.create({
            data: { userId: user.id, action: "opportunity", dayKey },
          });
        }

        return { slug: fresh.slug, alreadyComplete: false as const };
      });

      return Response.json({
        ok: true,
        step: "help",
        complete: true,
        slug: completed.slug,
        next: `/members/${completed.slug}?welcome=1`,
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

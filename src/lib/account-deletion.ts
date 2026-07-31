import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { deleteStoredImageForUser } from "@/lib/storage";

/** Anonymized name used everywhere a deleted account still needs a display value. */
export const DELETED_USER_NAME = "Deleted user";

export function hashFormerUserId(userId: string): string {
  return createHash("sha256").update(userId).digest("hex");
}

function anonymizedEmail(userId: string): string {
  return `deleted_${userId}@invalid.local`;
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Self-service account deletion.
 *
 * Strategy:
 * - Soft-delete / anonymize the User row in place so retained messages and
 *   transactions stay attributable as "Deleted user" (no clickable profile).
 * - Hard-delete every public-facing owned record (statuses, opportunities,
 *   listings, network, trips, verification, notifications, sessions, tokens).
 * - Best-effort delete Blob assets; queue StorageCleanupJob on failure.
 *
 * Caller must authenticate, block adminsource, and verify password first.
 */
export async function deleteOwnAccount(
  userId: string,
): Promise<{ ok: true; storageCleanupOk: boolean }> {
  let verificationDocs: { id: string; url: string }[] = [];
  let listings: {
    id: string;
    images: string;
    listingImages: { url: string }[];
  }[] = [];
  let userRow: {
    photo: string;
    cover: string;
    slug: string | null;
    username: string | null;
    profileVideoUrl: string;
    profileVideoPosterUrl: string;
  } | null = null;
  let storyClips: Array<{
    id: string;
    videoUrl: string;
    thumbnailUrl: string;
  }> = [];

  try {
    [verificationDocs, listings, userRow, storyClips] = await Promise.all([
      prisma.verificationDocument.findMany({
        where: { request: { userId }, deletedAt: null },
        select: { id: true, url: true },
      }),
      prisma.stockListing.findMany({
        where: { userId },
        select: {
          id: true,
          images: true,
          listingImages: { select: { url: true } },
        },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          photo: true,
          cover: true,
          slug: true,
          username: true,
          profileVideoUrl: true,
          profileVideoPosterUrl: true,
        },
      }),
      prisma.storyClip.findMany({
        where: { userId, deletedAt: null },
        select: { id: true, videoUrl: true, thumbnailUrl: true },
      }),
    ]);
  } catch (err) {
    console.error("[account-deletion] asset inventory failed", err);
  }

  const listingIds = listings.map((l) => l.id);
  const opportunityIds = (
    await prisma.opportunity.findMany({
      where: { userId },
      select: { id: true },
    })
  ).map((o) => o.id);

  const assetUrls = Array.from(
    new Set(
      [
        ...verificationDocs.map((d) => d.url),
        ...listings.flatMap((l) => [
          ...l.listingImages.map((i) => i.url),
          ...parseJsonArray(l.images),
        ]),
        userRow?.photo || "",
        userRow?.cover || "",
        userRow?.profileVideoUrl || "",
        userRow?.profileVideoPosterUrl || "",
        ...storyClips.map((c) => c.videoUrl),
        ...storyClips.map((c) => c.thumbnailUrl),
      ].filter((url): url is string => Boolean(url)),
    ),
  );

  await prisma.$transaction(
    async (tx) => {
      // Explicitly clear FK references that would otherwise leave public
      // dangling links to deleted listings / opportunities.
      if (listingIds.length) {
        await tx.conversation.updateMany({
          where: { listingId: { in: listingIds } },
          data: { listingId: null },
        });
        await tx.sourcingRequest.updateMany({
          where: { listingId: { in: listingIds } },
          data: { listingId: null },
        });
        await tx.transaction.updateMany({
          where: { listingId: { in: listingIds } },
          data: { listingId: null },
        });
      }
      if (opportunityIds.length) {
        await tx.conversation.updateMany({
          where: { opportunityId: { in: opportunityIds } },
          data: { opportunityId: null },
        });
        await tx.sourcingRequest.updateMany({
          where: { opportunityId: { in: opportunityIds } },
          data: { opportunityId: null },
        });
        await tx.transaction.updateMany({
          where: { opportunityId: { in: opportunityIds } },
          data: { opportunityId: null },
        });
      }

      // Public content — hard delete so Live Activity / Explore never surface it.
      await tx.statusUpdate.deleteMany({ where: { userId } });
      await tx.opportunity.deleteMany({ where: { userId } });
      await tx.stockListing.deleteMany({ where: { userId } });
      await tx.networkLocation.deleteMany({ where: { userId } });
      await tx.trip.deleteMany({ where: { userId } });

      // Reviews on their profile and reviews they wrote.
      await tx.review.deleteMany({ where: { revieweeId: userId } });
      await tx.review.deleteMany({ where: { reviewerId: userId } });

      // Social graph.
      await tx.follow.deleteMany({ where: { followerId: userId } });
      await tx.follow.deleteMany({
        where: { followingId: userId, followingIsSeed: false },
      });

      // Auth + rate limits.
      await tx.emailVerificationToken.deleteMany({ where: { userId } });
      await tx.passwordResetToken.deleteMany({ where: { userId } });
      await tx.session.deleteMany({ where: { userId } });
      await tx.rateLimitEvent.deleteMany({ where: { userId } });
      await tx.sellerPaymentMethod.deleteMany({ where: { userId } });

      // Notifications addressed to them OR naming them as actor.
      await tx.notification.deleteMany({
        where: { OR: [{ userId }, { actorId: userId }] },
      });

      // Identity verification + private document metadata (files deleted after tx).
      await tx.identityVerificationRequest.deleteMany({ where: { userId } });

      // System-only conversations where this user is the sole participant.
      const soleSystemParts = await tx.conversationParticipant.findMany({
        where: { userId, leftAt: null },
        select: {
          conversationId: true,
          conversation: {
            select: {
              contextType: true,
              participants: {
                where: { leftAt: null },
                select: { userId: true },
              },
            },
          },
        },
      });
      const soleSystemIds = soleSystemParts
        .filter(
          (p) =>
            p.conversation.contextType === "system" &&
            p.conversation.participants.length === 1 &&
            p.conversation.participants[0]?.userId === userId,
        )
        .map((p) => p.conversationId);
      if (soleSystemIds.length) {
        await tx.conversation.deleteMany({
          where: { id: { in: soleSystemIds } },
        });
      }

      // Mark remaining participations as left so they cannot receive new mail.
      await tx.conversationParticipant.updateMany({
        where: { userId, leftAt: null },
        data: { leftAt: new Date() },
      });
      await tx.conversationBlock.deleteMany({ where: { userId } });

      await tx.storyClip.updateMany({
        where: { userId, deletedAt: null },
        data: { status: "DELETED", deletedAt: new Date() },
      });
      await tx.storyView.deleteMany({ where: { viewerUserId: userId } });

      // Soft-delete / anonymize — frees email + username for re-registration.
      await tx.user.update({
        where: { id: userId },
        data: {
          name: DELETED_USER_NAME,
          username: null,
          slug: null,
          email: anonymizedEmail(userId),
          photo: "",
          cover: "",
          bio: "",
          publicDisplayMessage: "",
          city: "",
          country: "",
          memberType: "",
          specialties: "[]",
          passwordHash: null,
          mustChangePassword: false,
          adminPasswordCreated: false,
          emailVerified: false,
          identityVerified: false,
          identityVerificationStatus: "UNVERIFIED",
          onboardingComplete: false,
          isDiscoverable: false,
          isTestAccount: false,
          profileVideoUrl: "",
          profileVideoPosterUrl: "",
          profileVideoPathname: "",
          profileVideoPosterPathname: "",
          profileVideoMime: "",
          profileVideoDurationSec: null,
          profileVideoSizeBytes: null,
          profileVideoCaption: "",
          profileVideoUpdatedAt: null,
          deletedAt: new Date(),
        },
      });
    },
    { timeout: 30_000 },
  );

  let storageCleanupOk = true;
  for (const url of assetUrls) {
    try {
      const success = await deleteStoredImageForUser(url, userId);
      if (!success) {
        storageCleanupOk = false;
        await prisma.storageCleanupJob
          .create({
            data: {
              urlOrPath: url,
              kind: "blob",
              lastError: "delete_failed_during_account_deletion",
            },
          })
          .catch(() => null);
      }
    } catch {
      storageCleanupOk = false;
      await prisma.storageCleanupJob
        .create({
          data: {
            urlOrPath: "[redacted]",
            kind: "blob",
            lastError: "delete_threw_during_account_deletion",
          },
        })
        .catch(() => null);
    }
  }

  await prisma.accountDeletionAudit
    .create({
      data: {
        formerUserIdHash: hashFormerUserId(userId),
        storageCleanupOk,
        storageCleanupNote: storageCleanupOk
          ? ""
          : "One or more blob assets failed to delete and were queued for retry",
        meta: JSON.stringify({
          assetCount: assetUrls.length,
          listingCount: listingIds.length,
          opportunityCount: opportunityIds.length,
          verificationDocCount: verificationDocs.length,
        }),
      },
    })
    .catch((err) =>
      console.error("[account-deletion] audit write failed", err),
    );

  // Bust any cached public surfaces immediately.
  try {
    revalidatePath("/explore");
    revalidatePath("/activity");
    revalidatePath("/api/feed");
    revalidatePath("/api/members");
    if (userRow?.slug) revalidatePath(`/members/${userRow.slug}`);
    if (userRow?.username) revalidatePath(`/members/${userRow.username}`);
  } catch (err) {
    console.error("[account-deletion] revalidate failed", err);
  }

  return { ok: true, storageCleanupOk };
}

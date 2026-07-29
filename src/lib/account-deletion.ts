import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { invalidateAllSessions } from "@/lib/auth";
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
 * Self-service account deletion. Anonymizes the User row in place (keeps
 * the id so messages/reviews/transactions remain attributable to "Deleted
 * user") while hard-deleting everything else the user owns, and
 * best-effort deletes their blob assets (queuing retries on failure).
 *
 * Caller is responsible for auth, admin/last-admin guards, and password
 * verification before invoking this.
 */
export async function deleteOwnAccount(
  userId: string,
): Promise<{ ok: true; storageCleanupOk: boolean }> {
  const [verificationDocs, listings, userRow] = await Promise.all([
    prisma.verificationDocument.findMany({
      where: { request: { userId }, deletedAt: null },
      select: { url: true },
    }),
    prisma.stockListing.findMany({
      where: { userId },
      select: { images: true, listingImages: { select: { url: true } } },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { photo: true, cover: true },
    }),
  ]);

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
      ].filter((url): url is string => Boolean(url)),
    ),
  );

  await invalidateAllSessions(userId);

  await prisma.$transaction(async (tx) => {
    await tx.statusUpdate.deleteMany({ where: { userId } });
    await tx.opportunity.deleteMany({ where: { userId } });
    await tx.stockListing.deleteMany({ where: { userId } });
    await tx.sellerPaymentMethod.deleteMany({ where: { userId } });
    await tx.follow.deleteMany({ where: { followerId: userId } });
    await tx.follow.deleteMany({
      where: { followingId: userId, followingIsSeed: false },
    });
    await tx.emailVerificationToken.deleteMany({ where: { userId } });
    await tx.passwordResetToken.deleteMany({ where: { userId } });
    await tx.notification.deleteMany({ where: { userId } });
    await tx.rateLimitEvent.deleteMany({ where: { userId } });
    await tx.identityVerificationRequest.deleteMany({ where: { userId } });
    await tx.networkLocation.deleteMany({ where: { userId } });
    await tx.trip.deleteMany({ where: { userId } });

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
        emailVerified: false,
        onboardingComplete: false,
        isDiscoverable: false,
        deletedAt: new Date(),
      },
    });
  });

  let storageCleanupOk = true;
  for (const url of assetUrls) {
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
        .catch((err) => console.error("[account-deletion] queue cleanup job failed", err));
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
        meta: JSON.stringify({ assetCount: assetUrls.length }),
      },
    })
    .catch((err) => console.error("[account-deletion] audit write failed", err));

  return { ok: true, storageCleanupOk };
}

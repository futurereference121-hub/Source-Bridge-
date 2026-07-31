import type { Prisma } from "@prisma/client";

/**
 * Baseline filter for every public-facing member lookup (directory, search,
 * feeds, profile pages).
 *
 * Eligible when the account is active, discoverable, has a username/slug,
 * finished email verification + onboarding, and is not admin/test/deleted.
 * Photo, bio, location, verification badge, status, and opportunities are
 * intentionally NOT required.
 */
export const publicMemberWhere = {
  emailVerified: true,
  onboardingComplete: true,
  username: { not: null },
  slug: { not: null },
  deletedAt: null,
  isDiscoverable: true,
  isTestAccount: false,
  role: { not: "ADMIN" },
  isAdmin: false,
} as const satisfies Prisma.UserWhereInput;

export type MessageRecipientCheck = {
  isAdmin: boolean;
  role: string;
  isTestAccount: boolean;
  isDemo?: boolean;
  deletedAt: Date | null;
  isDiscoverable: boolean;
};

/**
 * Guards direct-message / sourcing-request recipients. Throws an HTTP-style
 * error (`.status` set) so route handlers can surface it via their existing
 * catch-all error mapping. Never let admins, test fixtures, demo showcase,
 * deleted, or non-discoverable accounts receive messages from the public.
 */
export function assertUserCanReceiveMessages(
  user: MessageRecipientCheck | null | undefined,
): asserts user is MessageRecipientCheck {
  if (!user) {
    const err = new Error("Recipient not found") as Error & { status: number };
    err.status = 404;
    throw err;
  }
  if (
    user.isAdmin ||
    user.role === "ADMIN" ||
    user.isTestAccount ||
    user.isDemo ||
    user.deletedAt ||
    !user.isDiscoverable
  ) {
    const err = new Error(
      user.isDemo
        ? "Showcase profiles cannot receive messages"
        : "This account cannot receive messages",
    ) as Error & { status: number };
    err.status = 403;
    throw err;
  }
}

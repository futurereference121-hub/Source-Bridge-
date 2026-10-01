/**
 * Preview-only insert of the synthetic @testingtesting user and its
 * already-verified Sandbox recipient mapping. No Stripe writes.
 */

import { prisma } from "@/lib/db";
import {
  discoverSandboxFixture,
  discoveryHash8,
} from "@/lib/payments/payout-rail/preview-sandbox-discovery";
import {
  isValidUsername,
  normalizeUsername,
  slugFromUsername,
} from "@/lib/validation";

const PREVIEW_HOST_H8 = "bf232aa9";
const FIXTURE = {
  username: normalizeUsername("testingtesting"),
  name: "GP Sandbox Test User",
  email: "gp-testingtesting@example.invalid",
};

function previewHostH8(): string | null {
  const raw = String(process.env.DATABASE_URL || "").trim();
  if (!raw) return null;
  try {
    const host = new URL(raw.replace(/^postgresql:/, "postgres:")).hostname;
    return discoveryHash8(host);
  } catch {
    return null;
  }
}

function initiationIsFalse(): boolean {
  const raw = String(process.env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED || "")
    .trim()
    .toLowerCase();
  return raw === "false" || raw === "0";
}

function stripIds<T extends { fixtureIds?: unknown }>(value: T) {
  const { fixtureIds: _ids, ...redacted } = value;
  void _ids;
  return redacted;
}

export async function restorePreviewSandboxFixture() {
  if (!isValidUsername(FIXTURE.username) || slugFromUsername(FIXTURE.username) !== FIXTURE.username) {
    return { ok: false, error: "fixture_username_invalid", db_rows_written: 0, stripe_writes: 0 };
  }
  const host_h8 = previewHostH8();
  if (host_h8 !== PREVIEW_HOST_H8) {
    return { ok: false, error: "database_host_mismatch", host_h8, db_rows_written: 0, stripe_writes: 0 };
  }
  if (!initiationIsFalse()) {
    return { ok: false, error: "initiation_not_false", db_rows_written: 0, stripe_writes: 0 };
  }

  const discovered = await discoverSandboxFixture();
  const discovery = stripIds(discovered);
  if (!discovered.ok || !discovered.fixtureIds) {
    return {
      ok: false,
      error: discovery.error || "stripe_not_verified",
      host_h8,
      discovery,
      db_rows_written: 0,
      stripe_writes: 0,
    };
  }
  const live = discovered.recipient;
  const method = discovered.payout_method;
  if (
    !live ||
    !method ||
    live.livemode_is_false !== true ||
    method.livemode_is_false !== true ||
    live.country !== "TH" ||
    method.country !== "TH" ||
    live.payout_method_ready !== true ||
    live.selected_ready_method_matches_historical !== true ||
    method.prefix_and_hash_match_count !== 1 ||
    method.scoped_by_stripe_context !== true ||
    method.archived === true
  ) {
    return {
      ok: false,
      error: "live_fixture_not_ready",
      host_h8,
      discovery,
      db_rows_written: 0,
      stripe_writes: 0,
    };
  }

  const { recipientId, payoutMethodId } = discovered.fixtureIds;
  const status = live.app_status;
  const payoutMethodReady = live.payout_method_ready;

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const users = await tx.user.findMany({
        where: {
          OR: [
            { username: FIXTURE.username },
            { email: FIXTURE.email },
            { slug: FIXTURE.username },
          ],
        },
        include: { globalPayoutRecipients: true },
      });
      const byRecipient = await tx.globalPayoutRecipient.findUnique({
        where: { stripeRecipientId: recipientId },
      });
      const byMethod = await tx.globalPayoutRecipient.findFirst({
        where: { defaultPayoutMethodId: payoutMethodId },
      });
      if (users.length > 1) return { kind: "conflict" as const, error: "multiple_user_matches" };

      const user = users[0];
      if (byRecipient && (!user || byRecipient.userId !== user.id)) {
        return { kind: "conflict" as const, error: "recipient_linked_elsewhere" };
      }
      if (byMethod && (!user || byMethod.userId !== user.id)) {
        return { kind: "conflict" as const, error: "payout_method_linked_elsewhere" };
      }
      if (user) {
        const recipient = user.globalPayoutRecipients[0];
        const exact =
          user.username === FIXTURE.username &&
          user.email === FIXTURE.email &&
          user.name === FIXTURE.name &&
          user.slug === FIXTURE.username &&
          user.passwordHash == null &&
          user.isTestAccount === true &&
          user.globalPayoutRecipients.length === 1 &&
          recipient?.stripeMode === "TEST" &&
          recipient.stripeRecipientId === recipientId &&
          recipient.defaultPayoutMethodId === payoutMethodId &&
          recipient.country === "TH" &&
          recipient.status === status &&
          recipient.payoutMethodReady === payoutMethodReady;
        if (!exact) return { kind: "conflict" as const, error: "partial_or_conflicting_fixture" };
        return { kind: "existing" as const, userId: user.id };
      }
      if (byRecipient || byMethod) {
        return { kind: "conflict" as const, error: "mapping_without_fixture_user" };
      }

      const created = await tx.user.create({
        data: {
          email: FIXTURE.email,
          name: FIXTURE.name,
          username: FIXTURE.username,
          slug: FIXTURE.username,
          passwordHash: null,
          isTestAccount: true,
          globalPayoutRecipients: {
            create: {
              stripeMode: "TEST",
              stripeRecipientId: recipientId,
              status,
              country: "TH",
              defaultPayoutMethodId: payoutMethodId,
              payoutMethodReady,
              recipientType: "individual",
              lastSyncedAt: new Date(),
            },
          },
        },
      });
      return { kind: "created" as const, userId: created.id };
    });

    if (outcome.kind === "conflict") {
      return {
        ok: false,
        error: outcome.error,
        host_h8,
        discovery,
        db_rows_written: 0,
        stripe_writes: 0,
      };
    }

    const [userCount, recipientCount, txnCount, attemptCount] = await Promise.all([
      prisma.user.count({
        where: {
          OR: [{ username: FIXTURE.username }, { email: FIXTURE.email }],
        },
      }),
      prisma.globalPayoutRecipient.count({
        where: { userId: outcome.userId, stripeMode: "TEST" },
      }),
      prisma.protectedTransaction.count(),
      prisma.outboundPaymentAttempt.count(),
    ]);

    return {
      ok: userCount === 1 && recipientCount === 1 && txnCount === 0 && attemptCount === 0,
      error:
        userCount === 1 && recipientCount === 1 && txnCount === 0 && attemptCount === 0
          ? null
          : "post_write_count_mismatch",
      created: outcome.kind === "created",
      host_h8,
      user_id_h8: discoveryHash8(outcome.userId),
      recipient_h8: discoveryHash8(recipientId),
      payout_method_h8: discoveryHash8(payoutMethodId),
      app_status: status,
      payout_method_ready: payoutMethodReady,
      counts: {
        matching_users: userCount,
        test_recipients_for_user: recipientCount,
        protected_transactions: txnCount,
        outbound_attempts: attemptCount,
      },
      initiation_is_false: true,
      db_rows_written: outcome.kind === "created" ? 2 : 0,
      stripe_writes: 0,
    };
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "";
    return {
      ok: false,
      error: code === "P2002" ? "unique_conflict" : "restore_failed",
      host_h8,
      db_rows_written: 0,
      stripe_writes: 0,
    };
  }
}

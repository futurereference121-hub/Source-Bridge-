/**
 * Audit and repair messaging conversations.
 *
 * Dry-run by default. Pass --confirm to write.
 *
 * Usage:
 *   node --env-file=.env.local --import=dotenv/config scripts/repair-conversations.mjs
 *   node --env-file=.env.local --import=dotenv/config scripts/repair-conversations.mjs --confirm
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CONFIRM = process.argv.includes("--confirm");
const DRY = !CONFIRM;

function pairKey(a, b) {
  return [a, b].sort().join(":");
}

function parsePair(parts) {
  const ids = [...parts].sort();
  if (ids.length !== 2 || ids[0] === ids[1]) return null;
  return pairKey(ids[0], ids[1]);
}

async function main() {
  console.log(`=== Conversation repair (${DRY ? "DRY-RUN" : "CONFIRM"}) ===\n`);

  const conversations = await prisma.conversation.findMany({
    include: {
      participants: { where: { leftAt: null }, select: { userId: true } },
      messages: { select: { id: true }, take: 1 },
      _count: { select: { messages: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const findings = {
    missingPairKey: 0,
    duplicates: 0,
    merged: 0,
    emptyNoMessages: 0,
    systemSkipped: 0,
    irreparable: 0,
    notificationsFixed: 0,
  };

  /** @type {Map<string, typeof conversations>} */
  const byPair = new Map();

  for (const c of conversations) {
    if (c.contextType === "system") {
      findings.systemSkipped += 1;
      continue;
    }
    const userIds = c.participants.map((p) => p.userId);
    const key = parsePair(userIds);
    if (!key) {
      findings.irreparable += 1;
      console.log(`IRREPARABLE ${c.id}: participants=${userIds.join(",")}`);
      continue;
    }
    if (!c.pairKey) findings.missingPairKey += 1;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(c);
  }

  for (const [key, group] of byPair) {
    if (group.length === 1) {
      const only = group[0];
      if (!only.pairKey || only.pairKey !== key) {
        console.log(`SET pairKey ${only.id} → ${key}`);
        if (!DRY) {
          try {
            await prisma.conversation.update({
              where: { id: only.id },
              data: { pairKey: key },
            });
          } catch (e) {
            console.log(`  failed: ${e.message}`);
          }
        }
      }
      continue;
    }

    findings.duplicates += 1;
    // Keep the conversation with most messages, then newest activity.
    const ranked = [...group].sort((a, b) => {
      const mc = b._count.messages - a._count.messages;
      if (mc !== 0) return mc;
      const at = a.lastMessageAt?.getTime() || a.createdAt.getTime();
      const bt = b.lastMessageAt?.getTime() || b.createdAt.getTime();
      return bt - at;
    });
    const keep = ranked[0];
    const dupes = ranked.slice(1);
    console.log(
      `DUPLICATE pair ${key}: keep ${keep.id} (${keep._count.messages} msgs), merge ${dupes.map((d) => d.id).join(", ")}`,
    );

    if (DRY) continue;

    for (const d of dupes) {
      await prisma.$transaction(async (tx) => {
        await tx.message.updateMany({
          where: { conversationId: d.id },
          data: { conversationId: keep.id },
        });
        await tx.transaction.updateMany({
          where: { conversationId: d.id },
          data: { conversationId: keep.id },
        });
        // Move unique sourcingRequestId if keep lacks one.
        if (d.sourcingRequestId && !keep.sourcingRequestId) {
          await tx.conversation.update({
            where: { id: keep.id },
            data: { sourcingRequestId: d.sourcingRequestId },
          });
          keep.sourcingRequestId = d.sourcingRequestId;
        } else if (d.sourcingRequestId) {
          await tx.conversation.update({
            where: { id: d.id },
            data: { sourcingRequestId: null },
          });
        }
        await tx.conversationParticipant.deleteMany({
          where: { conversationId: d.id },
        });
        await tx.conversationBlock.deleteMany({
          where: { conversationId: d.id },
        });
        await tx.conversation.delete({ where: { id: d.id } });
      });
      findings.merged += 1;
    }

    await prisma.conversation.update({
      where: { id: keep.id },
      data: { pairKey: key, closedAt: null },
    });

    // Fix notifications that pointed at merged ids.
    for (const d of dupes) {
      const notifs = await prisma.notification.findMany({
        where: { href: `/inbox/${d.id}` },
        select: { id: true },
      });
      if (notifs.length) {
        await prisma.notification.updateMany({
          where: { id: { in: notifs.map((n) => n.id) } },
          data: { href: `/inbox/${keep.id}` },
        });
        findings.notificationsFixed += notifs.length;
      }
    }
  }

  // Empty conversations with no messages and no pair activity.
  const empties = await prisma.conversation.findMany({
    where: {
      contextType: { not: "system" },
      messages: { none: {} },
      transactions: { none: {} },
    },
    select: { id: true, pairKey: true, createdAt: true },
  });
  findings.emptyNoMessages = empties.length;
  for (const e of empties) {
    // Only delete very recent empty shells older than... keep them if dry.
    console.log(`EMPTY ${e.id} created ${e.createdAt.toISOString()}`);
  }

  console.log("\n--- Summary ---");
  console.log(findings);
  if (DRY) console.log("\nDry-run only. Re-run with --confirm to apply.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

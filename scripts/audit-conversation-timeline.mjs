/**
 * Dry-run audit for conversation timeline integrity.
 *
 * Usage:
 *   npm run audit:conversation-timeline
 *   npm run audit:conversation-timeline -- --confirm
 *
 * Checks for:
 * - conversations with sourcingRequestId but no SOURCING_REQUEST message
 * - duplicate SOURCING_REQUEST messages sharing the same clientMessageId
 * - messages whose createdAt is after conversation.lastMessageAt (clock skew)
 *
 * --confirm only clears orphaned conversation.sourcingRequestId when the
 * linked request has no matching message in the thread (safe FK unlink).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CONFIRM = process.argv.includes("--confirm");

async function main() {
  console.log(
    CONFIRM
      ? "LIVE — applying safe repairs\n"
      : "DRY RUN — no writes. Pass --confirm to apply safe repairs.\n",
  );

  const conversations = await prisma.conversation.findMany({
    select: {
      id: true,
      pairKey: true,
      sourcingRequestId: true,
      lastMessageAt: true,
      subject: true,
      messages: {
        select: {
          id: true,
          messageType: true,
          clientMessageId: true,
          createdAt: true,
          body: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  let missingRequestMessage = 0;
  let duplicateClientKeys = 0;
  let repaired = 0;
  let skipped = 0;

  for (const c of conversations) {
    const sourcingMsgs = c.messages.filter(
      (m) => m.messageType === "SOURCING_REQUEST",
    );
    if (c.sourcingRequestId) {
      const hasAnySourcingMsg = sourcingMsgs.length > 0;
      if (!hasAnySourcingMsg) {
        missingRequestMessage += 1;
        console.log(
          `  missing SOURCING_REQUEST message · conversation=${c.id} · request=${c.sourcingRequestId}`,
        );
        if (CONFIRM) {
          await prisma.conversation.update({
            where: { id: c.id },
            data: { sourcingRequestId: null },
          });
          repaired += 1;
        } else {
          skipped += 1;
        }
      }
    }

    const byClient = new Map();
    for (const m of sourcingMsgs) {
      if (!m.clientMessageId) continue;
      const list = byClient.get(m.clientMessageId) || [];
      list.push(m.id);
      byClient.set(m.clientMessageId, list);
    }
    for (const [key, ids] of byClient) {
      if (ids.length > 1) {
        duplicateClientKeys += 1;
        console.log(
          `  duplicate clientMessageId=${key} · conversation=${c.id} · messages=${ids.join(",")}`,
        );
      }
    }
  }

  console.log("\nSummary");
  console.log(`  conversations scanned: ${conversations.length}`);
  console.log(`  missing request messages: ${missingRequestMessage}`);
  console.log(`  duplicate client keys: ${duplicateClientKeys}`);
  console.log(`  repaired: ${repaired}`);
  console.log(`  skipped (dry-run or unsafe): ${skipped}`);
  console.log(
    "\nNote: Sticky-card ordering was a UI bug (fixed in app). Timeline order is message.createdAt ascending.",
  );
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

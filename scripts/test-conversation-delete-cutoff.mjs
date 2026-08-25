/**
 * Delete ≠ Hide: deletedBeforeAt cutoff + list reconcile + unread.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const schema = read("prisma/schema.prisma");
const hide = read("src/lib/conversation-hide.ts");
const patch = read("src/app/api/conversations/[id]/route.ts");
const messages = read("src/app/api/conversations/[id]/messages/route.ts");
const list = read("src/app/api/conversations/route.ts");
const inbox = read("src/components/messaging/MessagesInbox.tsx");
const messaging = read("src/lib/messaging.ts");
const mig = read(
  "prisma/migrations/20260823160000_conversation_delete_cutoff/migration.sql",
);

assert.match(schema, /deletedBeforeAt/);
assert.match(mig, /deletedBeforeAt/);
assert.match(hide, /deleteConversationForUser/);
assert.match(hide, /deletedBeforeAt/);
assert.match(hide, /messageVisibleToUserWhere\(/);
assert.match(hide, /createdAt: \{ gt: deletedBeforeAt \}/);
assert.match(hide, /ticketsVisibleAfterDeleteCutoff/);
assert.match(patch, /deleteConversationForUser/);
assert.match(patch, /action === "delete"/);
assert.match(patch, /ticketsVisibleAfterDeleteCutoff/);
assert.match(list, /deletedBeforeAt/);
assert.match(messages, /ticketsVisibleAfterDeleteCutoff/);
assert.match(messages, /activityVersion/);
assert.match(messages, /bumpConversationActivity/);
assert.match(
  messages,
  /bumpConversationActivity[\s\S]*createNotifications/,
  "activity bump must precede MESSAGE notifications",
);
assert.match(inbox, /setInterval\(\(\) => void softList\(\), 8000\)/);
assert.match(inbox, /floorMs/);
assert.match(
  inbox,
  /subscribeToNewNotifications[\s\S]*(MESSAGE|PAYMENT_DISPUTE)[\s\S]*softList/,
  "MESSAGE / PAYMENT_DISPUTE notifications must trigger Inbox softList (no notify-ahead)",
);
assert.match(messaging, /deletedBeforeAt/);
assert.match(messaging, /hides: \{ none: \{ userId \} \}/);
assert.match(messages, /activityVersion/);
assert.match(
  messages,
  /return Response\.json\(\s*\{[\s\S]*activityVersion/,
  "send response must include activityVersion for Inbox catch-up",
);

console.log("[test-conversation-delete-cutoff] passed");

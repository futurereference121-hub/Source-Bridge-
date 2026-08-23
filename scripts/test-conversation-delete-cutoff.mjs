/**
 * Delete ≠ Hide: deletedBeforeAt cutoff + list reconcile.
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
const list = read("src/app/api/conversations/route.ts");
const inbox = read("src/components/messaging/MessagesInbox.tsx");
const mig = read(
  "prisma/migrations/20260823160000_conversation_delete_cutoff/migration.sql",
);

assert.match(schema, /deletedBeforeAt/);
assert.match(mig, /deletedBeforeAt/);
assert.match(hide, /deleteConversationForUser/);
assert.match(hide, /deletedBeforeAt/);
assert.match(hide, /messageVisibleToUserWhere\(/);
assert.match(hide, /createdAt: \{ gt: deletedBeforeAt \}/);
assert.match(patch, /deleteConversationForUser/);
assert.match(patch, /action === "delete"/);
assert.match(list, /deletedBeforeAt/);
assert.match(inbox, /setInterval\(\(\) => void softList\(\), 8000\)/);

console.log("[test-conversation-delete-cutoff] passed");

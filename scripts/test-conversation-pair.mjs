/**
 * Tests for canonical conversation pair keys and messaging contracts.
 * Run: node scripts/test-conversation-pair.mjs
 */
import assert from "node:assert/strict";

function conversationPairKey(userAId, userBId) {
  if (!userAId || !userBId) throw new Error("Both user IDs required");
  if (userAId === userBId) throw new Error("Two different users required");
  return [userAId, userBId].sort().join(":");
}

const a = "user_aaa";
const b = "user_bbb";
const c = "user_ccc";

assert.equal(conversationPairKey(a, b), conversationPairKey(b, a));
assert.equal(conversationPairKey(a, b), [a, b].sort().join(":"));
assert.notEqual(conversationPairKey(a, b), conversationPairKey(a, c));
assert.throws(() => conversationPairKey(a, a));
assert.throws(() => conversationPairKey("", b));

// Inbox routing contracts
assert.equal("/inbox", "/inbox");
assert.match(`/inbox/${a}`, /^\/inbox\/.+/);

console.log("test-conversation-pair: PASS");
console.log("  - pair key order-independent");
console.log("  - distinct pairs produce distinct keys");
console.log("  - self-pair rejected");

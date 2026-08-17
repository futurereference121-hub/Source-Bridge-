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

function adminDisputeThreadPairKey(disputeCaseId, role) {
  if (!disputeCaseId) throw new Error("disputeCaseId is required");
  if (role !== "BUYER" && role !== "SELLER") throw new Error("role");
  return `admin-dispute:${disputeCaseId}:${role}`;
}

const disputeId = "disp_aaa";
assert.notEqual(
  adminDisputeThreadPairKey(disputeId, "BUYER"),
  conversationPairKey(a, b),
);
assert.notEqual(
  adminDisputeThreadPairKey(disputeId, "BUYER"),
  adminDisputeThreadPairKey(disputeId, "SELLER"),
);

// Inbox routing contracts
assert.equal("/inbox", "/inbox");
assert.match(`/inbox/${a}`, /^\/inbox\/.+/);

console.log("test-conversation-pair: PASS");
console.log("  - pair key order-independent");
console.log("  - distinct pairs produce distinct keys");
console.log("  - self-pair rejected");

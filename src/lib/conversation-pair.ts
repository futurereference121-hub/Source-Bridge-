/**
 * Canonical conversation pair key — order-independent.
 * User A + User B === User B + User A.
 */
export function conversationPairKey(userAId: string, userBId: string): string {
  if (!userAId || !userBId) {
    throw new Error("Both user IDs are required for a conversation pair key");
  }
  if (userAId === userBId) {
    throw new Error("A conversation pair requires two different users");
  }
  return [userAId, userBId].sort().join(":");
}

export function parseConversationPairKey(pairKey: string): [string, string] | null {
  const parts = String(pairKey || "").split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1] || parts[0] === parts[1]) {
    return null;
  }
  return [parts[0], parts[1]];
}

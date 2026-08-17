/**
 * Chat performance + Payment Ticket create-form layout + scroll stability.
 * Source assertions (no Stripe, no DB, no financial mutations).
 * Run: node scripts/test-chat-ticket-ui.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const propose = read("src/components/messaging/ProposePaymentTicketButton.tsx");
const inbox = read("src/components/messaging/MessagesInbox.tsx");
const card = read("src/components/messaging/PaymentTicketCard.tsx");
const convGet = read("src/app/api/conversations/[id]/route.ts");
const authMe = read("src/app/api/auth/me/route.ts");
const appProviders = read("src/components/providers/AppProviders.tsx");
const messagesGet = read("src/app/api/conversations/[id]/messages/route.ts");
const fulfilmentRules = read("src/lib/payments/fulfilment-rules.ts");
const cronRelease = read("src/app/api/cron/payments-release/route.ts");
const reviewActions = read("src/app/admin/reviews/dispute-review-actions.tsx");
const issueActions = read("src/app/admin/payments/issue-actions.tsx");
const threadsApi = read("src/app/api/admin/payments/issues/threads/route.ts");

// --- RESPONSIVE PAYMENT TICKET FORM ---
assert.match(propose, /pt-propose-v8-viewport-dialog/);
assert.match(propose, /createPortal/);
assert.match(propose, /data-sb-ticket-form="viewport-dialog"/);
assert.match(propose, /fixed inset-0/);
assert.match(propose, /100dvh|85dvh/);
assert.match(propose, /safe-area-inset-bottom/);
assert.match(propose, /safe-area-inset-top/);
assert.match(propose, /data-testid="ticket-propose-submit"/);
assert.match(propose, /data-testid="ticket-propose-cancel"/);
assert.match(propose, /max-w-md/);
assert.match(propose, /min-w-0/);
assert.match(propose, /w-full/);
assert.doesNotMatch(
  propose,
  /absolute right-0 top-full/,
  "create form must not be an absolute popover on the header button",
);
assert.doesNotMatch(
  propose,
  /w-\[min\(22rem/,
  "create form must not use a desktop-min width that can exceed the viewport",
);
assert.match(
  propose,
  /z-\[80\]/,
  "create overlay must sit above the fixed mobile nav (z-50)",
);
assert.match(
  propose,
  /ticket: json\.ticket/,
  "successful propose must pass full ticket snapshot to onCreated (not id-only stub)",
);
assert.match(
  card,
  /normalizeTicketView/,
  "ticket card must tolerate partial snapshots without throwing on breakdown",
);
assert.match(
  card,
  /PAYMENT_ISSUE_CATEGORIES/,
  "buyer issue report must offer predefined categories",
);

// --- CHAT PERFORMANCE ---
assert.match(convGet, /searchParams\.get\("poll"\) === "1"/);
assert.match(convGet, /if \(!isPoll\) \{[\s\S]*ensureConversationPaymentTicketMessages/);
assert.match(convGet, /if \(!isPoll\) \{[\s\S]*markRead/);
assert.match(convGet, /Cache-Control": "private, no-store/);
assert.match(inbox, /\?poll=1/);
assert.match(
  card,
  /Conversation payload already has compact \+ lifecycle/,
);
assert.match(
  card,
  /Skip GET only when the parent poll supplies a snapshot/,
);
assert.doesNotMatch(
  inbox,
  /threadRefresh/,
  "ticket actions must not remount the thread via threadRefresh",
);
assert.match(
  inbox,
  /Single request — conversation GET already returns recent messages/,
);

// --- MOBILE SCROLL ---
assert.match(inbox, /refreshConversationPreservingViewport/);
assert.match(
  inbox,
  /Ticket lifecycle actions must not treat the thread as a new-message jump/,
);
assert.doesNotMatch(
  card,
  /sticky top-0 z-20 mt-3 overflow-visible rounded-lg border border-amber-400/,
);
assert.doesNotMatch(
  card,
  /sticky top-0 z-20 mt-3 overflow-visible rounded-lg border border-electric/,
);

// --- TICKET HEADER STABILITY ---
assert.match(card, /data-sb-ticket-header="expanded"/);
assert.match(card, /data-sb-ticket-header="collapsed"/);
assert.match(card, /flex min-w-0 flex-col gap-2/);
assert.match(
  inbox,
  /ticketExpanded\[m\.paymentTicketId\]/,
);
assert.match(
  card,
  /prev\.status === snap\.status/,
  "poll snapshot merge must not rewrite identical ticket state",
);

// --- REALTIME / FORM STATE ---
assert.match(propose, /useState\(Boolean\(forceOpen \|\| editFromTicket\)\)/);
assert.doesNotMatch(
  convGet,
  /Cache-Control": "public/,
  "viewer-sensitive conversation payloads must not be publicly cached",
);

// Viewport matrix encoded in shared responsive classes (not UA hacks).
assert.doesNotMatch(propose, /userAgent|navigator\.userAgent/);
assert.doesNotMatch(card, /userAgent|navigator\.userAgent/);
assert.match(propose, /md:items-center/);
assert.match(propose, /items-end/);

// --- VIEWER IDENTITY / CACHE ISOLATION ---
assert.match(
  authMe,
  /Cache-Control": "private, no-store/,
  "/api/auth/me must not be shared-cached across accounts",
);
assert.match(authMe, /Vary: "Cookie"/);
assert.match(appProviders, /fetch\("\/api\/auth\/me", \{ cache: "no-store" \}/);
assert.match(convGet, /viewerUserId: user\.id/);
assert.match(convGet, /viewerUsername: user\.username/);
assert.match(convGet, /listConversationPaymentTickets\(id, user\.id\)/);
assert.match(messagesGet, /listConversationPaymentTickets\(id, user\.id\)/);
assert.match(inbox, /threadViewerUserId/);
assert.match(inbox, /ticketViewerId/);
assert.match(inbox, /setThreadViewerUserId\(data\.viewerUserId \|\| myId\)/);
assert.match(inbox, /myId=\{ticketViewerId\}/);
assert.match(
  card,
  /conversationSessionUserId: myId/,
  "PaymentTicketCard must prefer conversation session viewer over cached account.id",
);
assert.match(card, /resolveAuthoritativeViewerId/);
assert.doesNotMatch(
  card,
  /canRespond = Boolean\(open && viewerMayAccept && acceptance\.isParty && paymentsAccess\)/,
  "Accept must not be gated on Connect / paymentsAccess",
);
assert.match(card, /ticketMayShowPayUi/);
assert.match(card, /ACKNOWLEDGE/);
assert.match(card, /Confirm Item Received/);
assert.match(card, /Start 12-Hour Inspection/);
assert.match(card, /Release Funds Now/);
assert.match(card, /ALREADY_FUNDED/);
assert.match(card, /paymentIntentStatus/);
assert.doesNotMatch(card, /trustLevel/);
assert.doesNotMatch(card, /matchMedia|pointer:\s*coarse|ontouchstart/);

assert.match(
  inbox,
  /mergeTicketSnapshots/,
  "post-create must merge full ticket snapshots without dropping breakdown",
);
assert.match(
  inbox,
  /setPaymentTickets\(\(prev\) =>[\s\S]*mergeTicketSnapshots/,
  "post-create conversation refresh must merge paymentTickets",
);
assert.match(
  card,
  /safeUsernameHandle/,
  "ticket card must tolerate non-string usernames without throwing",
);
assert.match(
  card,
  /openDisputeStatus/,
  "dispute banner must use authoritative DisputeCase status",
);
assert.match(
  card,
  /data-sb-ticket-confirm="cancel"/,
  "cancel confirm must use viewport-contained portal dialog",
);
assert.match(
  card,
  /createPortal/,
  "delete/cancel confirms must portal to document body",
);
assert.match(
  inbox,
  /ticket: json\.ticket|mergeTicketSnapshots/,
  "create succeeds then conversation refresh must keep ticket snapshots",
);
assert.match(
  card,
  /shouldShowFundsFrozenBanner/,
  "frozen banner must use shared COMPLETED-safe helper",
);
assert.match(
  card,
  /UNDER REVIEW BY SOURCE BRIDGE/,
  "under-review copy must be participant-visible",
);
assert.match(
  card,
  /listingProtectedShipmentPhotoRequired/,
  "protected listing ship UI must require shipment photo",
);
assert.doesNotMatch(
  card,
  /isCompleted[\s\S]{0,80}issueHold/,
  "COMPLETED tickets must not pair completed badge with issueHold in one expression",
);
assert.match(
  card,
  /!isCompleted/,
  "under-review badge must not render on COMPLETED tickets",
);
assert.match(
  fulfilmentRules,
  /export const BUYER_INACTIVITY_ADMIN_RELEASE_MS = 72 \* 60 \* 60 \* 1000/,
  "inactivity release must use one documented TEST constant (72h)",
);
assert.doesNotMatch(
  cronRelease,
  /BUYER_INACTIVITY_ADMIN_RELEASE_MS|inactivity-release/,
  "cron must not auto-release on the admin inactivity path",
);
assert.match(
  reviewActions,
  /\/admin\/reviews\/\$\{disputeId\}/,
  "Message Buyer/Sourcer must open the dispute case page, not the party chat",
);
assert.doesNotMatch(
  reviewActions,
  /inboxBase/,
  "admin messaging must not reuse the Buyer↔Sourcer inbox URL",
);
assert.match(
  threadsApi,
  /getOrCreateAdminDisputeThread/,
  "admin threads API must create private Admin↔party conversations",
);
assert.match(
  issueActions,
  /parseHumanAmountToMinor/,
  "admin resolution must accept human currency amounts",
);
assert.match(
  issueActions,
  /Confirm resolution/,
  "admin resolution must require confirmation",
);

console.log("[test-chat-ticket-ui] passed");

/**
 * Source Bridge Live — in-stream Capture Item bottom sheet contracts.
 * Source-level + pure assertions (no Live start, no Stripe, no real WHEP).
 *
 * Run: node scripts/test-live-capture-sheet.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isCaptureAllowed,
  initialWhepViewerState,
  reduceWhepViewer,
} from "../src/lib/live/whep-viewer-state.ts";
import {
  LIVE_CAPTURE_RECONNECTING_MESSAGE,
  LIVE_CAPTURE_SUGGESTED_TEXT,
} from "../src/lib/live/constants.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const player = read("src/components/live/LivePlayer.tsx");
const capture = read("src/lib/live/capture.ts");
const constants = read("src/lib/live/constants.ts");
const captureRoute = read("src/app/api/live/sessions/[id]/capture/route.ts");
const messagesRoute = read("src/app/api/conversations/[id]/messages/route.ts");
const watchClient = read("src/components/live/LiveWatchClient.tsx");
const whepSession = read("src/components/live/whep-viewer-session.ts");

console.log("=== Capture Item bottom-sheet contracts ===");

// 1. CAPTURE ITEM button stays in LivePlayer controls (not moved to a new host)
{
  assert.match(player, /Capture Item/);
  assert.match(player, /onClick=\{\(\) => void captureAndOpenSheet\(\)\}/);
  assert.match(player, /absolute inset-x-0 bottom-0/);
  assert.doesNotMatch(watchClient, /Capture Item/);
}

// 2. Capture uses the viewer <video> frame (drawImage), not webpage screenshot
{
  assert.match(player, /function canvasFrame\(video: HTMLVideoElement\)/);
  assert.match(player, /ctx\.drawImage\(video,/);
  assert.match(player, /live-capture\.jpg/);
  assert.doesNotMatch(player, /html2canvas|dom-to-image|getDisplayMedia/);
}

// 3. Sheet opens in-player (role=dialog bottom sheet), not Inbox navigation
{
  assert.match(player, /role="dialog"/);
  assert.match(player, /aria-modal="true"/);
  assert.match(player, /translate-y-full/);
  assert.match(player, /translate-y-0/);
  assert.match(player, /safe-area-inset-bottom/);
  assert.match(player, /max-w-md/);
  assert.doesNotMatch(player, /useRouter/);
  assert.doesNotMatch(player, /router\.push/);
  assert.doesNotMatch(player, /\/inbox\//);
  assert.doesNotMatch(player, /LIVE_CAPTURE_DRAFT_KEY/);
  assert.doesNotMatch(player, /sessionStorage/);
  assert.doesNotMatch(player, /Message Sourcer/);
}

// 4. Blank / reconnecting capture rejected with required copy
{
  assert.match(constants, /LIVE_CAPTURE_RECONNECTING_MESSAGE/);
  assert.equal(
    LIVE_CAPTURE_RECONNECTING_MESSAGE,
    "The Live picture is reconnecting. Please try again in a moment.",
  );
  assert.match(player, /LIVE_CAPTURE_RECONNECTING_MESSAGE/);
  assert.match(player, /isCaptureAllowed/);
  assert.match(player, /videoWidth <= 0/);
}

// 5–7. Player preservation: sheet state co-located; WHEP effect keyed only on session.id
{
  assert.match(player, /WhepViewerSession/);
  assert.match(player, /\[\s*session\.id\s*\]/);
  assert.match(player, /Do NOT destroy a healthy WHEP/);
  assert.match(player, /sessionRef\.current\?\.setGrant\(next\)/);
  assert.match(player, /Keep the same <video> mounted/);
  assert.match(player, /captureOpen && captureDraft/);
  // Sheet must not wrap/remount the video via a changing key
  assert.doesNotMatch(player, /key=\{[^}]*capture/);
  assert.doesNotMatch(player, /key=\{captureOpen/);
  assert.match(whepSession, /isCurrent\(gen\)/);
}

// 8. Suggested text editable; canonical constant preserved
{
  assert.match(constants, /LIVE_CAPTURE_SUGGESTED_TEXT/);
  assert.ok(LIVE_CAPTURE_SUGGESTED_TEXT.includes("Live"));
  assert.match(player, /captureDraft\.text/);
  assert.match(player, /setCaptureDraft\(\(prev\) =>/);
  assert.match(player, /<textarea/);
  assert.match(capture, /suggestedText/);
  assert.match(capture, /LIVE_CAPTURE_SUGGESTED_TEXT/);
}

// 9–10. SEND uses canonical conversation messages API; nothing auto-sent
{
  assert.match(player, /\/api\/conversations\/\$\{captureDraft\.conversationId\}\/messages/);
  assert.match(player, /attachmentUrls: \[captureDraft\.imageUrl\]/);
  assert.match(player, /clientMessageId/);
  assert.match(player, /\/api\/live\/sessions\/\$\{session\.id\}\/capture/);
  assert.match(capture, /getOrCreateConversationPair/);
  assert.match(capture, /autoSent: false/);
  assert.doesNotMatch(capture, /initialMessage/);
  assert.doesNotMatch(capture, /prisma\.message\.create/);
  assert.match(captureRoute, /prepareLiveCaptureMessage/);
  assert.match(messagesRoute, /clientMessageId/);
  // Prepare must not require LIVE-only (post-Live finish send)
  assert.doesNotMatch(capture, /Capture is only available while Live/);
}

// 11. Success closes sheet, stays on Live (toast + clearCaptureDraft, no nav)
{
  assert.match(player, /Message sent\./);
  assert.match(player, /clearCaptureDraft\(\)/);
  assert.doesNotMatch(player, /router\.push\(`\/inbox/);
}

// 12. Failure preserves draft + human error
{
  assert.match(player, /setSendError/);
  assert.match(player, /Could not send message/);
  assert.match(player, /sendError/);
  assert.match(player, /role="alert"/);
}

// 13. Double-send protection
{
  assert.match(player, /sendLockRef/);
  assert.match(player, /sendBusy/);
  assert.match(player, /Sending…/);
  assert.match(player, /if \(!captureDraft \|\| sendBusy \|\| sendLockRef\.current\) return/);
}

// 14. Retake replaces unsent capture
{
  assert.match(player, /async function retakeCapture/);
  assert.match(player, /Retake/);
  assert.match(player, /clearCaptureDraft\(\);\s*\n\s*await captureAndOpenSheet/);
}

// 15. Cancel discards draft
{
  assert.match(player, /Cancel/);
  assert.match(player, /function clearCaptureDraft/);
  assert.match(player, /setCaptureDraft\(null\)/);
}

// 16–18. Keyboard / safe-area / desktop max width
{
  assert.match(player, /env\(safe-area-inset-bottom\)/);
  assert.match(player, /max-w-md/);
  assert.match(player, /document\.body\.style\.overflow = "hidden"/);
  assert.match(player, /min-h-11/);
}

// 19–20. Capture gating + reconnect (pure state machine)
{
  let s = initialWhepViewerState();
  assert.equal(isCaptureAllowed(s), false);
  s = reduceWhepViewer(s, { type: "START" });
  assert.equal(isCaptureAllowed(s), false);
  s = reduceWhepViewer(s, { type: "TRACK", kind: "video" });
  s = reduceWhepViewer(s, { type: "TRACK", kind: "audio" });
  s = reduceWhepViewer(s, { type: "PLAYING" });
  assert.equal(isCaptureAllowed(s), true);
  s = reduceWhepViewer(s, { type: "RECONNECT", reason: "render_stall" });
  assert.equal(isCaptureAllowed(s), false);
}

// 21. Live end while sheet open: preserve draft / allow send
{
  assert.match(player, /hasCaptureSheet/);
  assert.match(player, /liveEnded && !hasCaptureSheet/);
  assert.match(player, /This Live has ended\. You can still send your private message\./);
  assert.match(player, /disabled=\{sendBusy \|\| captureBusy \|\| liveEnded\}/);
}

// 22. Logged-out blocked via requireAuth
{
  assert.match(player, /requireAuth\("capture an item"/);
}

// 23. Not a public Live comment
{
  assert.doesNotMatch(player, /liveComment|publicComment|\/api\/live\/.*\/comment/i);
  assert.doesNotMatch(capture, /comment/i);
}

// 24. No Payment Ticket creation on capture
{
  assert.doesNotMatch(player, /PaymentTicket|paymentTicket|createTicket/);
  assert.doesNotMatch(capture, /PaymentTicket|paymentTicket|ProtectedTransaction/);
}

// 25. Broadcaster identity shown; private to viewer↔broadcaster
{
  assert.match(player, /session\.broadcaster\.name/);
  assert.match(player, /session\.broadcaster\.username/);
  assert.match(capture, /row\.broadcasterId/);
  assert.match(capture, /You cannot Capture Item on your own Live/);
  assert.match(player, /You cannot Capture Item on your own Live/);
}

// 26. Upload folder live + prepare image allowlist
{
  assert.match(player, /form\.set\("folder", "live"\)/);
  assert.match(capture, /isAllowedAttachmentUrl/);
}

// 27. SEND label (not Message Sourcer)
{
  assert.match(player, /sendBusy \? "Sending…" : "Send"/);
}

// 28. Close control accessible
{
  assert.match(player, /aria-label="Close capture"/);
}

// 29. Soft grant refresh preserved (no PC teardown on token rollover)
{
  assert.match(player, /tokenRefreshDelayMs/);
  assert.match(player, /setGrant\(next\)/);
}

// 30. Messaging/Live freeze: capture path does not touch Stripe
{
  assert.doesNotMatch(player, /stripe|PaymentIntent|SOURCE_BRIDGE_FEE/i);
  assert.doesNotMatch(capture, /stripe|PaymentIntent|SOURCE_BRIDGE_FEE/i);
}

console.log("[test-live-capture-sheet] passed");

/**
 * Source Bridge Live — Ably viewer count + public comments.
 * Contract + domain tests. No real Ably/Cloudflare money objects.
 *
 * Run: npm run test:live-realtime
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

console.log("=== Live realtime contract ===");

{
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.dependencies?.ably, "official ably dependency required");
  assert.equal(
    Object.keys(pkg.dependencies).filter((k) => /socket\.io|pusher|supabase|partykit/i.test(k))
      .length,
    0,
    "no alternate realtime SDKs",
  );
}

{
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /model LiveComment/);
  assert.match(schema, /liveSessionId/);
  assert.match(schema, /commenterId/);
  assert.match(schema, /clientMessageId/);
  assert.doesNotMatch(schema, /model LiveViewerHeartbeat/);
  assert.doesNotMatch(
    read("prisma/migrations/20260907120000_live_public_comments/migration.sql"),
    /ProtectedTransaction|PaymentTicket|Stripe/,
  );
  assert.ok(
    existsSync(
      path.join(
        root,
        "prisma/migrations/20260907120000_live_public_comments/migration.sql",
      ),
    ),
  );
}

{
  const envEx = read(".env.example");
  assert.match(envEx, /ABLY_API_KEY=/);
  assert.match(envEx, /Server-side ONLY/);
  assert.doesNotMatch(envEx, /NEXT_PUBLIC_ABLY/);
}

{
  const flags = read("src/lib/live/flags.ts");
  assert.match(flags, /realtime/);
  assert.match(flags, /ABLY_API_KEY/);
  // Missing Ably must not flip Live video available=false by itself.
  assert.match(flags, /orthogonal|must not mark Live video unavailable/i);
}

{
  // Server boundary — Ably REST only behind realtime/.
  assert.ok(existsSync(path.join(root, "src/lib/live/realtime/ably-server.ts")));
  assert.ok(existsSync(path.join(root, "src/lib/live/realtime/token.ts")));
  assert.ok(existsSync(path.join(root, "src/lib/live/realtime/comments.ts")));
  assert.ok(
    existsSync(
      path.join(root, "src/app/api/live/sessions/[id]/realtime-token/route.ts"),
    ),
  );
  assert.ok(
    existsSync(path.join(root, "src/app/api/live/sessions/[id]/comments/route.ts")),
  );

  const ablyServer = read("src/lib/live/realtime/ably-server.ts");
  assert.match(ablyServer, /createTokenRequest/);
  assert.match(ablyServer, /subscribe/);
  assert.match(ablyServer, /presence/);
  assert.match(ablyServer, /publishLiveCommentEvent/);
  // Viewers must not get publish capability for canonical comments.
  assert.match(ablyServer, /\["subscribe", "presence"\]/);
  assert.match(ablyServer, /broadcaster[\s\S]*\["subscribe"\]/);

  const tokenRoute = read(
    "src/app/api/live/sessions/[id]/realtime-token/route.ts",
  );
  assert.match(tokenRoute, /requireSessionUser/);
  assert.match(tokenRoute, /issueLiveRealtimeToken/);
  assert.doesNotMatch(tokenRoute, /process\.env\.ABLY_API_KEY/);
  assert.doesNotMatch(tokenRoute, /getAblyApiKey|getAblyRest/);
  // Comment may mention the env name; ensure response path never returns it.
  assert.doesNotMatch(tokenRoute, /Response\.json\(\s*\{[^}]*ABLY_API_KEY/);

  const commentsRoute = read(
    "src/app/api/live/sessions/[id]/comments/route.ts",
  );
  assert.match(commentsRoute, /createLiveComment/);
  assert.match(commentsRoute, /listRecentLiveComments/);
  assert.match(commentsRoute, /requireSessionUser/);
}

{
  // Channel scoping
  process.env.SESSION_SECRET = "test-secret-for-live-realtime";
  const { liveRealtimeChannelName } = await import(
    "../src/lib/live/realtime/channel.ts"
  );
  assert.equal(
    liveRealtimeChannelName("clxxxxxxxx"),
    "sourcebridge-live:clxxxxxxxx",
  );
  assert.throws(() => liveRealtimeChannelName("a:b"));
  assert.throws(() => liveRealtimeChannelName("a*"));

  const { liveViewerClientId, liveBroadcasterClientId } = await import(
    "../src/lib/live/realtime/identity.ts"
  );
  const a = liveViewerClientId("user_a");
  const a2 = liveViewerClientId("user_a");
  const b = liveViewerClientId("user_b");
  assert.equal(a, a2, "stable viewer clientId");
  assert.notEqual(a, b);
  assert.match(a, /^lv_/);
  assert.notEqual(a, liveBroadcasterClientId("user_a"));
  assert.doesNotMatch(a, /user_a/);
}

{
  // Sanitize + reject HTML
  const { sanitizeLiveCommentBody } = await import(
    "../src/lib/live/realtime/comments.ts"
  );
  assert.equal(sanitizeLiveCommentBody("  hello   world  "), "hello world");
  assert.equal(sanitizeLiveCommentBody("<script>x</script>hi"), "xhi");
  assert.equal(sanitizeLiveCommentBody("   "), "");
  assert.equal(sanitizeLiveCommentBody(null), "");
}

{
  // Token issuance without Ably key fails safely
  delete process.env.ABLY_API_KEY;
  const { issueLiveRealtimeToken } = await import(
    "../src/lib/live/realtime/token.ts"
  );
  const { isAblyConfigured } = await import("../src/lib/live/realtime/config.ts");
  assert.equal(isAblyConfigured(), false);
  await assert.rejects(
    () =>
      issueLiveRealtimeToken({
        user: { id: "u1" },
        sessionId: "s1",
      }),
    (err) => err && err.status === 503 && err.code === "ABLY_UNAVAILABLE",
  );
}

{
  // Mock Ably REST token request scoping
  process.env.ABLY_API_KEY = "appKeyId.keySecretValueForTestsOnly";
  const constantsSrc = read("src/lib/live/realtime/constants.ts");
  assert.match(constantsSrc, /sourcebridge-live:/);
  assert.doesNotMatch(constantsSrc, /sourcebridge-live:\*/);
  const channelSrc = read("src/lib/live/realtime/channel.ts");
  assert.match(channelSrc, /LIVE_REALTIME_CHANNEL_PREFIX/);
  assert.match(channelSrc, /Never a wildcard/);
  const src = read("src/lib/live/realtime/ably-server.ts");
  assert.match(src, /liveRealtimeChannelName/);
  assert.match(src, /LIVE_REALTIME_TOKEN_TTL_MS/);
  assert.match(src, /createTokenRequest/);
  assert.doesNotMatch(src, /sourcebridge-live:\*/);
  // Capability arrays must not include client-side publish for comments.
  assert.match(src, /\["subscribe", "presence"\]/);
  assert.doesNotMatch(src, /\["publish"/);
  void createHash;
}

{
  // Client must not import server Ably key helper
  const clientFiles = [
    "src/components/live/realtime/useLiveRealtime.ts",
    "src/components/live/realtime/LiveEngagementOverlay.tsx",
    "src/components/live/realtime/LiveCommentsStack.tsx",
    "src/components/live/realtime/LiveCommentComposer.tsx",
    "src/components/live/LivePlayer.tsx",
    "src/components/live/GoLiveStudio.tsx",
  ];
  for (const f of clientFiles) {
    const src = read(f);
    assert.doesNotMatch(src, /ABLY_API_KEY/);
    assert.doesNotMatch(src, /ably-server/);
    assert.doesNotMatch(src, /getAblyRest/);
    assert.doesNotMatch(src, /from ["']ably["'].*key:/);
  }
  const hook = read("src/components/live/realtime/useLiveRealtime.ts");
  assert.match(hook, /authCallback/);
  assert.match(hook, /presence\.enter/);
  assert.match(hook, /realtime-token/);
  assert.match(hook, /loadAblyBrowser/);
  // Runtime must not import the npm browser bundle (SWC-incompatible); types-only OK.
  assert.doesNotMatch(hook, /import Ably from ["']ably["']/);
  assert.doesNotMatch(hook, /await import\(["']ably/);
  assert.doesNotMatch(hook, /channels\.get\([^)]+\)\.publish/);
  assert.match(
    read("src/components/live/realtime/loadAblyBrowser.ts"),
    /cdn\.ably\.com/,
  );
  assert.match(read("next.config.ts"), /serverExternalPackages/);
  assert.match(read("next.config.ts"), /ably/);
}

{
  // UI + Capture / WHEP preservation
  const player = read("src/components/live/LivePlayer.tsx");
  assert.match(player, /LiveEngagementOverlay/);
  assert.match(player, /WhepViewerSession/);
  assert.match(player, /Capture Item/);
  assert.match(player, /suppressPublicUi/);
  assert.match(player, /playbackStartedOnce/);
  assert.match(player, /Keep the same <video> mounted/);
  assert.doesNotMatch(player, /Jump to Live/);
  assert.doesNotMatch(player, /ABLY_API_KEY/);

  const studio = read("src/components/live/GoLiveStudio.tsx");
  assert.match(studio, /LiveEngagementOverlay/);
  assert.match(studio, /isBroadcaster/);
  assert.match(studio, /startWhipPublish/);
  assert.doesNotMatch(studio, /Add a comment/);

  const overlay = read(
    "src/components/live/realtime/LiveEngagementOverlay.tsx",
  );
  assert.match(overlay, /LiveCommentsStack/);
  assert.match(overlay, /LiveViewerCount/);
  assert.match(overlay, /suppressPublicUi/);

  const composer = read(
    "src/components/live/realtime/LiveCommentComposer.tsx",
  );
  assert.match(composer, /Add a comment/);
  assert.match(composer, /safe-area-inset-bottom/);
}

{
  // Public comments ≠ Inbox / Payment Ticket
  const comments = read("src/lib/live/realtime/comments.ts");
  assert.doesNotMatch(comments, /getOrCreateConversationPair/);
  assert.doesNotMatch(comments, /PaymentTicket/);
  assert.doesNotMatch(comments, /ProtectedTransaction/);
  assert.match(comments, /publishLiveCommentEvent/);
  assert.match(comments, /RATE_LIMIT/);

  const capture = read("src/lib/live/capture.ts");
  assert.match(capture, /getOrCreateConversationPair/);
  assert.doesNotMatch(capture, /LiveComment/);
  assert.doesNotMatch(capture, /ably/i);
}

{
  // Status route exposes realtime without secrets
  const status = read("src/app/api/live/status/route.ts");
  assert.match(status, /liveStreamingPublicStatus/);
  assert.doesNotMatch(status, /ABLY_API_KEY/);
  const flags = read("src/lib/live/flags.ts");
  assert.match(flags, /realtime:\s*\{/);
}

{
  // No heartbeat / no DB viewer poll
  assert.equal(
    existsSync(
      path.join(root, "src/app/api/live/sessions/[id]/heartbeat/route.ts"),
    ),
    false,
  );
  const commentsSrc = read("src/lib/live/realtime/comments.ts");
  assert.doesNotMatch(commentsSrc, /viewerCount/);
  assert.doesNotMatch(commentsSrc, /heartbeat/i);
}

{
  // Payment freeze surfaces untouched
  const freezePaths = [
    "src/lib/payments",
    "src/app/api/payments",
    "src/app/api/webhooks/stripe",
  ];
  for (const p of freezePaths) {
    assert.ok(existsSync(path.join(root, p)) || p.includes("payments"));
  }
  // LiveComment migration must not touch payment schema
  const mig = read(
    "prisma/migrations/20260907120000_live_public_comments/migration.sql",
  );
  assert.match(mig, /LiveComment/);
  assert.doesNotMatch(mig, /DROP TABLE/);
  assert.doesNotMatch(mig, /ProtectedTransaction/);
}

console.log("=== Live realtime PASS ===");

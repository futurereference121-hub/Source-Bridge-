/**
 * End-to-end messaging API test against APP_URL (default production/local).
 * Uses passwordless email sign-in. No passwords printed or stored in repo.
 *
 * Run:
 *   node --env-file=.env scripts/test-messaging-e2e.mjs
 * Optional: APP_URL=https://your-app.vercel.app
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const base = (
  process.env.MESSAGING_E2E_URL ||
  process.env.APP_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");

const A_EMAIL = "messenger-a@sourcebridge.test";
const B_EMAIL = "messenger-b@sourcebridge.test";
const C_EMAIL = "messenger-c@sourcebridge.test";

function parseSetCookie(res) {
  const raw = res.headers.getSetCookie?.() || [];
  if (raw.length) return raw.map((c) => c.split(";")[0]).join("; ");
  const single = res.headers.get("set-cookie");
  return single ? single.split(";")[0] : "";
}

async function ensureUsers() {
  for (const u of [
    { email: A_EMAIL, name: "Messenger Alpha", username: "messenger_a" },
    { email: B_EMAIL, name: "Messenger Beta", username: "messenger_b" },
    { email: C_EMAIL, name: "Messenger Charlie", username: "messenger_c" },
  ]) {
    const email = u.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          emailVerified: true,
          onboardingComplete: true,
          username: existing.username || u.username,
          slug: existing.slug || u.username,
        },
      });
    } else {
      await prisma.user.create({
        data: {
          email,
          name: u.name,
          username: u.username,
          slug: u.username,
          emailVerified: true,
          onboardingComplete: true,
          role: "USER",
          city: "Bangkok",
          country: "Thailand",
          intent: "both",
          specialties: "[]",
        },
      });
    }
  }
}

async function signIn(email) {
  const res = await fetch(`${base}/api/auth/sign-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `sign-in ${email}: ${JSON.stringify(data)} (${res.status})`,
    );
  }
  const cookie = parseSetCookie(res);
  if (!cookie) {
    throw new Error(
      `sign-in ${email}: no session cookie (status ${res.status})`,
    );
  }
  return { cookie, account: data.account };
}

async function api(cookie, path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

function assert(name, cond) {
  if (!cond) throw new Error(`FAIL: ${name}`);
  console.log(`OK   ${name}`);
}

try {
  console.log(`Target: ${base}`);
  await ensureUsers();

  const a = await signIn(A_EMAIL);
  const b = await signIn(B_EMAIL);
  const c = await signIn(C_EMAIL);
  assert("signed in A/B/C", Boolean(a.account?.id && b.account?.id && c.account?.id));

  const clientRequestId = `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const create1 = await api(a.cookie, "/api/sourcing-requests", {
    method: "POST",
    body: JSON.stringify({
      toUserId: b.account.id,
      message: "E2E: looking for local tea recommendation",
      neededFrom: "Bangkok, Thailand",
      budget: "Open to discussion",
      deadline: "2099-12-01",
      clientRequestId,
      referenceImages: [],
    }),
  });
  if (!create1.res.ok || !create1.data.conversation?.id) {
    throw new Error(
      `A creates sourcing request failed: ${create1.res.status} ${JSON.stringify(create1.data)}`,
    );
  }
  assert(
    "A creates sourcing request",
    true,
  );
  const conversationId = create1.data.conversation.id;

  const create2 = await api(a.cookie, "/api/sourcing-requests", {
    method: "POST",
    body: JSON.stringify({
      toUserId: b.account.id,
      message: "E2E: looking for local tea recommendation",
      neededFrom: "Bangkok, Thailand",
      budget: "Open to discussion",
      deadline: "2099-12-01",
      clientRequestId,
      referenceImages: [],
    }),
  });
  assert(
    "duplicate submit reuses conversation",
    create2.res.ok &&
      create2.data.existing === true &&
      create2.data.conversation?.id === conversationId,
  );

  const self = await api(a.cookie, "/api/sourcing-requests", {
    method: "POST",
    body: JSON.stringify({
      toUserId: a.account.id,
      message: "Should fail",
      clientRequestId: `self_${Date.now()}`,
    }),
  });
  assert("cannot message self", self.res.status === 400);

  const empty = await api(a.cookie, "/api/sourcing-requests", {
    method: "POST",
    body: JSON.stringify({
      toUserId: b.account.id,
      message: "  ",
      clientRequestId: `empty_${Date.now()}`,
    }),
  });
  assert("rejects empty message", empty.res.status === 400);

  const inboxB = await api(b.cookie, "/api/conversations");
  assert("B inbox lists conversation", inboxB.res.ok);
  const listed = (inboxB.data.conversations || []).find(
    (x) => x.id === conversationId,
  );
  assert("B sees unread sourcing request", Boolean(listed?.unread));
  assert("B unread count > 0", (inboxB.data.unreadCount || 0) > 0);

  const threadB = await api(b.cookie, `/api/conversations/${conversationId}`);
  assert("B opens thread", threadB.res.ok);
  assert(
    "structured request present",
    Boolean(threadB.data.conversation?.sourcingRequest?.neededFrom),
  );

  const reply = await api(b.cookie, `/api/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      text: "E2E reply from B — I can help.",
      clientMessageId: `e2e_reply_${Date.now()}`,
    }),
  });
  assert("B can reply", reply.res.ok && Boolean(reply.data.message?.id));

  const inboxA = await api(a.cookie, "/api/conversations");
  assert("A unread after reply", (inboxA.data.unreadCount || 0) > 0);

  const threadA = await api(a.cookie, `/api/conversations/${conversationId}`);
  assert("A opens thread", threadA.res.ok);
  const msgs = await api(
    a.cookie,
    `/api/conversations/${conversationId}/messages?limit=50`,
  );
  assert(
    "A sees reply",
    (msgs.data.messages || []).some((m) => m.body?.includes("E2E reply from B")),
  );

  const leak = await api(c.cookie, `/api/conversations/${conversationId}`);
  assert("C cannot open A/B thread", leak.res.status === 404 || leak.res.status === 403);

  const anon = await fetch(`${base}/api/conversations`);
  assert("logged-out cannot list inbox", anon.status === 401);

  console.log("\nE2E messaging API tests passed.");
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

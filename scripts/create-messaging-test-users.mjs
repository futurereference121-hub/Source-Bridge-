/**
 * Create two messaging test users (no passwords — email sign-in).
 * Usage: npm run create-messaging-test-users
 * Does not print secrets beyond confirming emails.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const users = [
  {
    email: "messenger-a@sourcebridge.test",
    name: "Messenger Alpha",
    username: "messenger_a",
  },
  {
    email: "messenger-b@sourcebridge.test",
    name: "Messenger Beta",
    username: "messenger_b",
  },
];

async function ensureUser(input) {
  const email = input.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        emailVerified: true,
        onboardingComplete: true,
        username: existing.username || input.username,
        slug: existing.slug || input.username,
        name: existing.name || input.name,
        city: existing.city || "Bangkok",
        country: existing.country || "Thailand",
        isTestAccount: true,
        isDiscoverable: false,
      },
    });
    return existing.id;
  }
  const created = await prisma.user.create({
    data: {
      email,
      name: input.name,
      username: input.username,
      slug: input.username,
      emailVerified: true,
      onboardingComplete: true,
      identityVerified: false,
      identityVerificationStatus: "UNVERIFIED",
      role: "USER",
      city: "Bangkok",
      country: "Thailand",
      intent: "both",
      specialties: "[]",
      isTestAccount: true,
      isDiscoverable: false,
    },
  });
  return created.id;
}

try {
  for (const u of users) {
    const id = await ensureUser(u);
    console.log(`OK ${u.username} <${u.email}> id=${id}`);
  }
  console.log(
    "Sign in with these emails (no password). Test accounts are marked isTestAccount/non-discoverable, so they won't appear in Explore. Note: sourcing-request API calls now reject non-discoverable recipients — use /api/conversations (direct message) between these accounts instead.",
  );
} finally {
  await prisma.$disconnect();
}

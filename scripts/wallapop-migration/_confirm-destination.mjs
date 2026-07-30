import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const EXPECTED_USERNAME = "theowlsaid";
const EXPECTED_NAME = "Dominic kidd";

const u = await prisma.user.findFirst({
  where: { username: EXPECTED_USERNAME, deletedAt: null },
  select: {
    id: true,
    username: true,
    name: true,
    emailVerified: true,
    onboardingComplete: true,
  },
});

if (!u) {
  console.error("ABORT: destination account not found");
  process.exit(1);
}
if (u.username !== EXPECTED_USERNAME) {
  console.error("ABORT: username mismatch", u.username);
  process.exit(1);
}
if (u.name !== EXPECTED_NAME) {
  console.error("ABORT: display name mismatch", u.name);
  process.exit(1);
}

const productsOwned = await prisma.stockListing.count({
  where: { userId: u.id },
});

console.log(
  JSON.stringify(
    {
      username: `@${u.username}`,
      displayName: u.name,
      userId: u.id,
      productsOwned,
      emailVerified: u.emailVerified,
      onboardingComplete: u.onboardingComplete,
    },
    null,
    2,
  ),
);

await prisma.$disconnect();

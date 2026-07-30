import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({
    where: { username: "theowlsaid", deletedAt: null },
    select: {
      id: true,
      username: true,
      email: true,
      onboardingComplete: true,
      emailVerified: true,
      city: true,
      country: true,
      name: true,
    },
  });
  console.log(JSON.stringify(user, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

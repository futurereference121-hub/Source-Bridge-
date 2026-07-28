import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const prisma = new PrismaClient();
const email = (process.env.ADMIN_BOOTSTRAP_EMAIL || "adminsource@sourcebridge.local").toLowerCase();
const username = "adminsource";
const temporaryPassword = `A!a1${randomBytes(20).toString("base64url")}`;
const salt = randomBytes(16).toString("hex");
const passwordHash = `${salt}:${scryptSync(temporaryPassword, salt, 64).toString("hex")}`;

try {
  const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
  if (existing?.passwordHash) {
    console.log("Administrator account already exists with a password; no changes made.");
  } else if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { email, username, slug: username, role: "ADMIN", isAdmin: true, emailVerified: true, onboardingComplete: true, passwordHash, mustChangePassword: true },
    });
    console.log(`Temporary administrator password (shown once): ${temporaryPassword}`);
  } else {
    await prisma.user.create({
      data: { email, username, slug: username, name: "Source Bridge Administrator", role: "ADMIN", isAdmin: true, emailVerified: true, onboardingComplete: true, passwordHash, mustChangePassword: true },
    });
    console.log(`Temporary administrator password (shown once): ${temporaryPassword}`);
  }
} finally {
  await prisma.$disconnect();
}

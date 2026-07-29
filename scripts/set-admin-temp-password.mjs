/**
 * One-shot script: sets the adminsource account password to Admin123!
 * with mustChangePassword = true so the admin is forced to change it
 * on first login.
 *
 * Run once: node scripts/set-admin-temp-password.mjs
 * Safe to delete afterwards.
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const prisma = new PrismaClient();

function hashPassword(plain) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(plain, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
}

try {
  const user = await prisma.user.findFirst({
    where: { username: "adminsource", role: "ADMIN" },
  });

  if (!user) {
    console.error("ERROR: adminsource account not found. Run create-admin.mjs first.");
    process.exit(1);
  }

  const passwordHash = hashPassword("Admin123!");

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      mustChangePassword: true,
      adminPasswordCreated: true, // mark as having a password so create-password gate is skipped
      isAdmin: true,
      isDiscoverable: false,
      emailVerified: true,
      onboardingComplete: true,
    },
  });

  console.log("✓ adminsource temporary password set to: Admin123!");
  console.log("  mustChangePassword = true");
  console.log("  adminPasswordCreated = true");
  console.log("  Log in at /admin/sign-in — you will be redirected to change the password.");
} finally {
  await prisma.$disconnect();
}

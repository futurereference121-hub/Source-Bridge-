import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from "fs";
import path from "path";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const prisma = new PrismaClient();

function hashPassword(plain) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(plain, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(plain, stored) {
  const [salt, digest] = stored.split(":");
  const expected = Buffer.from(digest, "hex");
  const actual = scryptSync(plain, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function main() {
  console.log("OK ListingImage rows:", await prisma.listingImage.count());

  const dir = path.join(process.cwd(), "private", "verification", "test-probe");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "probe.bin");
  writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  console.log("OK private FS writable:", existsSync(file));
  unlinkSync(file);

  const temp = `A!a1${randomBytes(12).toString("base64url")}`;
  const hashed = hashPassword(temp);
  console.log("OK password hash roundtrip:", verifyPassword(temp, hashed));

  const admin = await prisma.user.findFirst({ where: { username: "adminsource" } });
  console.log(
    "INFO adminsource:",
    admin
      ? { role: admin.role, isAdmin: admin.isAdmin, hasPassword: Boolean(admin.passwordHash) }
      : "not created yet (run npm run create-admin)",
  );

  console.log(
    "OK VerificationAuditEvent readable, rows:",
    await prisma.verificationAuditEvent.count(),
  );

  // Simulate ordered listing image sync uniqueness constraint presence
  const sample = await prisma.stockListing.findFirst({
    include: { listingImages: { orderBy: { sortOrder: "asc" } } },
  });
  if (sample) {
    console.log(
      "OK sample listing images:",
      sample.listingImages.length,
      "json:",
      JSON.parse(sample.images || "[]").length,
    );
  } else {
    console.log("INFO no listings yet to compare image counts");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

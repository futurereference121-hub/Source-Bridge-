/**
 * Expire Story clips and delete Blob assets.
 * Dry-run by default. Pass --confirm to apply.
 *
 *   npm run stories:expire
 *   npm run stories:expire -- --confirm
 */
import { PrismaClient } from "@prisma/client";
import { del } from "@vercel/blob";

const prisma = new PrismaClient();
const CONFIRM = process.argv.includes("--confirm");

async function deleteBlob(url, pathname, userId) {
  if (!url && !pathname) return true;
  const token = process.env.BLOB_READ_WRITE_TOKEN || undefined;
  try {
    if (url && url.startsWith("https://")) {
      await del(url, token ? { token } : undefined);
      return true;
    }
  } catch (err) {
    console.warn("Blob delete failed", userId, err instanceof Error ? err.message : err);
    return false;
  }
  return true;
}

async function main() {
  const now = new Date();
  const expired = await prisma.storyClip.findMany({
    where: {
      OR: [
        { status: "ACTIVE", expiresAt: { lte: now } },
        { status: "DELETED" },
        { deletedAt: { not: null }, status: { not: "EXPIRED" } },
      ],
    },
    take: 300,
  });

  console.log(
    CONFIRM
      ? `LIVE — expiring ${expired.length} clips\n`
      : `DRY RUN — would expire ${expired.length} clips. Pass --confirm.\n`,
  );

  let cleaned = 0;
  for (const clip of expired) {
    console.log(
      `  ${clip.id} user=${clip.userId} status=${clip.status} expires=${clip.expiresAt.toISOString()}`,
    );
    if (!CONFIRM) continue;
    await prisma.storyClip.update({
      where: { id: clip.id },
      data: { status: "EXPIRED", deletedAt: clip.deletedAt || now },
    });
    await deleteBlob(clip.videoUrl, clip.blobPathname, clip.userId);
    if (clip.thumbnailUrl) {
      await deleteBlob(clip.thumbnailUrl, clip.thumbnailBlobPathname, clip.userId);
    }
    await prisma.storyView.deleteMany({ where: { storyClipId: clip.id } });
    cleaned += 1;
  }

  console.log(`\nCleaned: ${cleaned}`);
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

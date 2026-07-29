import { prisma } from "@/lib/db";

/**
 * Public, read-only endpoint that tells the create-password page whether
 * first-time admin setup has already been completed.
 * Returns only a boolean — never leaks the admin user's details.
 */
export async function GET() {
  try {
    const user = await prisma.user.findFirst({
      where: { username: "adminsource", role: "ADMIN" },
      select: { adminPasswordCreated: true, passwordHash: true },
    });
    const setupComplete = Boolean(user?.adminPasswordCreated || user?.passwordHash);
    return Response.json({ setupComplete });
  } catch {
    // Fail-safe: treat any DB error as setup complete so the page redirects away.
    return Response.json({ setupComplete: true });
  }
}

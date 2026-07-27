import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, nextRouteForUser, toPublicAccount } from "@/lib/auth";
import { jsonError, signInSchema } from "@/lib/validation";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = signInSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }
    const email = parsed.data.email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return jsonError("No account found for that email. Join first.", 404);
    }

    await createSession(user.id);
    const next = nextRouteForUser(user);

    return Response.json({
      ok: true,
      account: toPublicAccount(user),
      next,
    });
  } catch (err) {
    console.error("[sign-in]", err);
    return jsonError("Could not sign in", 500);
  }
}

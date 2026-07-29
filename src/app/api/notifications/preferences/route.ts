import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { jsonError, notificationPreferencesSchema } from "@/lib/validation";

export async function GET() {
  try {
    const user = await requireSessionUser();
    return Response.json({
      notificationSoundsEnabled: user.notificationSoundsEnabled,
      notificationVolume: user.notificationVolume,
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[notifications:preferences:get]", err);
    return jsonError("Failed to load preferences", 500);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body = await req.json().catch(() => ({}));
    const parsed = notificationPreferencesSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid preferences", 400);
    }
    if (
      parsed.data.notificationSoundsEnabled === undefined &&
      parsed.data.notificationVolume === undefined
    ) {
      return jsonError("Nothing to update", 400);
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(parsed.data.notificationSoundsEnabled !== undefined
          ? { notificationSoundsEnabled: parsed.data.notificationSoundsEnabled }
          : {}),
        ...(parsed.data.notificationVolume !== undefined
          ? { notificationVolume: parsed.data.notificationVolume }
          : {}),
      },
      select: { notificationSoundsEnabled: true, notificationVolume: true },
    });

    return Response.json({ ok: true, ...updated });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[notifications:preferences:patch]", err);
    return jsonError("Failed to update preferences", status);
  }
}

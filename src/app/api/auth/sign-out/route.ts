import { destroySession } from "@/lib/auth";
import { jsonError } from "@/lib/validation";

export async function POST() {
  try {
    await destroySession();
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[sign-out]", err);
    return jsonError("Could not sign out", 500);
  }
}

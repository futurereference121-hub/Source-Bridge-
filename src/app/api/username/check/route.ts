import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isUsernameAvailable } from "@/lib/members-service";
import { isValidUsername, jsonError, normalizeUsername } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("u") || "";
  const username = normalizeUsername(raw);
  if (!username) return jsonError("Username required", 400);
  if (!isValidUsername(username)) {
    return Response.json({
      available: false,
      username,
      reason: "Invalid username. Use 3–30 letters, numbers, or underscores.",
    });
  }

  const session = await getSessionUser();
  const available = await isUsernameAvailable(username, session?.id);
  return Response.json({ available, username });
}

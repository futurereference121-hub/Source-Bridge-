import { getSessionUser, toPublicAccount } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ account: null });
  }
  return Response.json({ account: toPublicAccount(user) });
}

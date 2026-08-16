import { getSessionUser, toPublicAccount } from "@/lib/auth";

export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  Vary: "Cookie",
};

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ account: null }, { headers: NO_STORE });
  }
  return Response.json(
    { account: toPublicAccount(user) },
    { headers: NO_STORE },
  );
}

import { getSessionUser, isAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readPrivateStoredBytes } from "@/lib/storage";
import { jsonError } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await getSessionUser();
    if (!user) return jsonError("Sign in required", 401);
    const { id } = await ctx.params;
    const document = await prisma.verificationDocument.findUnique({
      where: { id },
      include: { request: { select: { userId: true } } },
    });
    if (!document || document.deletedAt || (!isAdminUser(user) && document.request.userId !== user.id)) {
      return jsonError("Document not found", 404);
    }
    const bytes = await readPrivateStoredBytes(document.url);
    if (!bytes) return jsonError("Document is unavailable", 404);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": document.mimeType || "application/octet-stream",
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, max-age=60",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[verification:document-file]", error);
    return jsonError("Could not load document", 500);
  }
}

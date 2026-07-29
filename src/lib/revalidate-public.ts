import { revalidatePath } from "next/cache";

/** Bust public directory / profile caches after signup-adjacent mutations. */
export function revalidatePublicMemberSurfaces(opts?: {
  slug?: string | null;
  username?: string | null;
}) {
  try {
    revalidatePath("/explore");
    revalidatePath("/activity");
    revalidatePath("/api/feed");
    revalidatePath("/api/members");
    if (opts?.slug) revalidatePath(`/members/${opts.slug}`);
    if (opts?.username && opts.username !== opts.slug) {
      revalidatePath(`/members/${opts.username}`);
    }
  } catch (err) {
    console.error(
      "[revalidate] public member surfaces failed",
      err instanceof Error ? err.message : err,
    );
  }
}

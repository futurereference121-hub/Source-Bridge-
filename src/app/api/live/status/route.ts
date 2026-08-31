import { liveStreamingPublicStatus } from "@/lib/live/flags";

export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
} as const;

/** Public: whether Go Live is offered. No secrets. */
export async function GET() {
  return Response.json(liveStreamingPublicStatus(), { headers: NO_STORE });
}

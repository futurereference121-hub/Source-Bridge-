import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Permanent profile video is replaced by Stories.
 * Kept as a clear 410 so old clients fail loudly.
 */
export async function GET() {
  return NextResponse.json(
    {
      error:
        "Profile video has been replaced by Stories. Create a Story from your profile picture.",
      code: "PROFILE_VIDEO_REMOVED",
    },
    { status: 410 },
  );
}

export async function POST() {
  return GET();
}

export async function DELETE() {
  return GET();
}

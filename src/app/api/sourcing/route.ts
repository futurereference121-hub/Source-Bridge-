import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body?.name || !body?.email || !body?.productRequired) {
      return NextResponse.json(
        { ok: false, message: "Missing required fields" },
        { status: 400 },
      );
    }
    // Stub — no persistence. Ready for future DB / email integration.
    return NextResponse.json({ ok: true, message: "Sourcing request received" });
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid request" }, { status: 400 });
  }
}

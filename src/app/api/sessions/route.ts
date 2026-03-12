import { NextResponse } from "next/server";

import { listSessions } from "@/lib/deep-research/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId")?.trim() ?? "";

    if (!workspaceId) {
      return NextResponse.json([]);
    }

    const sessions = await listSessions({
      workspaceId,
      limit: 24,
    });

    return NextResponse.json(sessions);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load sessions.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

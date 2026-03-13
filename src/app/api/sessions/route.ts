import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { listSessions } from "@/lib/deep-research/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId")?.trim() ?? "";

    if (!workspaceId) {
      return NextResponse.json([]);
    }

    const sessions = await listSessions({
      workspaceId,
      limit: 24,
      clerkUserId: userId,
    });

    return NextResponse.json(sessions);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load sessions.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

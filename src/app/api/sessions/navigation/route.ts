import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { listSessionNavigation } from "@/lib/deep-research/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const groups = await listSessionNavigation({
      limitPerWorkspace: 6,
      workspaceLimit: 8,
      clerkUserId: userId,
    });

    return NextResponse.json(groups);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to load session navigation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import { listSessionNavigation } from "@/lib/deep-research/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const groups = await listSessionNavigation({
      limitPerWorkspace: 6,
      workspaceLimit: 8,
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

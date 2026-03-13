import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { scheduleDeepResearchTask } from "@/lib/deep-research/background";
import {
  createDeepResearchRun,
  listDeepResearchRuns,
  processDeepResearchRun,
} from "@/lib/deep-research/service";
import { createDeepResearchRunRequestSchema } from "@/lib/deep-research/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId")?.trim() || undefined;
    const runs = await listDeepResearchRuns({
      workspaceId,
      limit: 12,
      clerkUserId: userId,
    });

    return NextResponse.json(runs);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load research runs.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const payload = createDeepResearchRunRequestSchema.parse(
      await request.json(),
    );
    const result = await createDeepResearchRun(payload, userId);

    if (result.created) {
      scheduleDeepResearchTask(
        () => processDeepResearchRun(result.run.id),
        "Deep research background run failed:",
      );
    }

    return NextResponse.json(result.run, {
      status: result.created ? 201 : 200,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create research run.";
    const status =
      message === "Workspace not found." || message === "Session not found."
        ? 404
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

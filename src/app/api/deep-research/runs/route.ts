import { after, NextResponse } from "next/server";

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
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId")?.trim() || undefined;
    const runs = await listDeepResearchRuns({
      workspaceId,
      limit: 12,
    });

    return NextResponse.json(runs);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load research runs.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = createDeepResearchRunRequestSchema.parse(
      await request.json(),
    );
    const run = await createDeepResearchRun(payload);

    after(async () => {
      try {
        await processDeepResearchRun(run.id);
      } catch (error) {
        console.error("Deep research background run failed:", error);
      }
    });

    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create research run.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

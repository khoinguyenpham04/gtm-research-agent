import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { scheduleDeepResearchTask } from "@/lib/deep-research/background";
import {
  getDeepResearchRun,
  processDeepResearchRun,
} from "@/lib/deep-research/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await context.params;
    const run = await getDeepResearchRun(id, userId);

    if (!run) {
      return NextResponse.json(
        { error: "Deep research run not found." },
        { status: 404 },
      );
    }

    if (!["failed", "timed_out"].includes(run.status)) {
      return NextResponse.json(
        { error: "Only failed or timed out runs can be retried." },
        { status: 409 },
      );
    }

    scheduleDeepResearchTask(
      () => processDeepResearchRun(id, { retry: true }),
      "Deep research retry failed:",
    );

    return NextResponse.json({
      ...run,
      status: "running",
      errorMessage: undefined,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to retry research run.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

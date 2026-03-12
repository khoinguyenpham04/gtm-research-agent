import { NextResponse } from "next/server";

import { scheduleDeepResearchTask } from "@/lib/deep-research/background";
import {
  canResumeDeepResearchRunFromCheckpoint,
  getDeepResearchRun,
  processDeepResearchRun,
} from "@/lib/deep-research/service";
import { resumeDeepResearchRunRequestSchema } from "@/lib/deep-research/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const run = await getDeepResearchRun(id);

    if (!run) {
      return NextResponse.json(
        { error: "Deep research run not found." },
        { status: 404 },
      );
    }

    if (run.status === "needs_clarification") {
      const payload = resumeDeepResearchRunRequestSchema.parse(
        await request.json(),
      );

      scheduleDeepResearchTask(
        () =>
          processDeepResearchRun(id, {
            clarificationResponse: payload.clarificationResponse,
          }),
        "Deep research clarification resume failed:",
      );

      return NextResponse.json({
        ...run,
        status: "running",
        clarificationQuestion: undefined,
      });
    }

    if (!["failed", "timed_out"].includes(run.status)) {
      return NextResponse.json(
        {
          error:
            "Only clarification-paused, failed, or timed out runs can be resumed.",
        },
        { status: 409 },
      );
    }

    const checkpointAvailable = await canResumeDeepResearchRunFromCheckpoint(id);
    if (!checkpointAvailable) {
      return NextResponse.json(
        {
          error:
            "No checkpoint is available for this run. Retry it instead.",
        },
        { status: 409 },
      );
    }

    scheduleDeepResearchTask(
      () =>
        processDeepResearchRun(id, {
          resumeFromCheckpoint: true,
        }),
      "Deep research checkpoint resume failed:",
    );

    return NextResponse.json({
      ...run,
      status: "running",
      errorMessage: undefined,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to resume research run.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

import { after, NextResponse } from "next/server";

import {
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
    const payload = resumeDeepResearchRunRequestSchema.parse(
      await request.json(),
    );
    const run = await getDeepResearchRun(id);

    if (!run) {
      return NextResponse.json(
        { error: "Deep research run not found." },
        { status: 404 },
      );
    }

    if (run.status !== "needs_clarification") {
      return NextResponse.json(
        { error: "This run is not waiting for clarification." },
        { status: 409 },
      );
    }

    after(async () => {
      try {
        await processDeepResearchRun(id, {
          clarificationResponse: payload.clarificationResponse,
        });
      } catch (error) {
        console.error("Deep research clarification resume failed:", error);
      }
    });

    return NextResponse.json({
      ...run,
      status: "running",
      clarificationQuestion: undefined,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to resume research run.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

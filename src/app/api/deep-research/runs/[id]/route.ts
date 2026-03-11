import { NextResponse } from "next/server";

import { getDeepResearchRun } from "@/lib/deep-research/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  _request: Request,
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

    return NextResponse.json(run);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load research run.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { getDeepResearchRun } from "@/lib/deep-research/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
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

    return NextResponse.json(run);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load research run.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  createSession,
  listSessions,
} from "@/lib/deep-research/service";
import { createSessionRequestSchema } from "@/lib/deep-research/types";

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

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const payload = createSessionRequestSchema.parse(await request.json());
    const session = await createSession({
      clerkUserId: userId,
      workspaceId: payload.workspaceId,
    });

    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid session request." },
        { status: 400 },
      );
    }

    const message =
      error instanceof Error ? error.message : "Failed to create session.";
    const status = message === "Workspace not found." ? 404 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

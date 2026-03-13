import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { ensureDeepResearchDatabase } from "@/lib/deep-research/db";
import {
  createWorkspace,
  createWorkspaceRequestSchema,
  listWorkspaces,
} from "@/lib/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await ensureDeepResearchDatabase();
    const workspaces = await listWorkspaces(userId);
    return NextResponse.json({ workspaces });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load workspaces.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await ensureDeepResearchDatabase();
    const payload = createWorkspaceRequestSchema.parse(await request.json());
    const workspace = await createWorkspace(payload, userId);
    return NextResponse.json(workspace, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create workspace.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

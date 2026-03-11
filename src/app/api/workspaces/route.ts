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
  try {
    await ensureDeepResearchDatabase();
    const workspaces = await listWorkspaces();
    return NextResponse.json({ workspaces });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load workspaces.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureDeepResearchDatabase();
    const payload = createWorkspaceRequestSchema.parse(await request.json());
    const workspace = await createWorkspace(payload);
    return NextResponse.json(workspace, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create workspace.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

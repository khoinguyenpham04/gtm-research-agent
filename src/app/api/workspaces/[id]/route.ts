import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { ensureDeepResearchDatabase } from "@/lib/deep-research/db";
import { getWorkspaceDetail, verifyWorkspaceOwnership } from "@/lib/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await ensureDeepResearchDatabase();
    const { id } = await context.params;

    const isOwner = await verifyWorkspaceOwnership(id, userId);
    if (!isOwner) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    }

    const workspace = await getWorkspaceDetail(id);
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    }

    return NextResponse.json(workspace);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load workspace.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

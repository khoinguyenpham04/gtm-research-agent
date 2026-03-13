import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { ensureDeepResearchDatabase } from "@/lib/deep-research/db";
import {
  attachDocumentsToWorkspace,
  attachWorkspaceDocumentsRequestSchema,
} from "@/lib/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await ensureDeepResearchDatabase();
    const { id } = await context.params;
    const payload = attachWorkspaceDocumentsRequestSchema.parse(
      await request.json(),
    );
    const workspace = await attachDocumentsToWorkspace(id, payload.documentIds, userId);
    return NextResponse.json(workspace);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to attach documents.";
    const status = message === "Workspace not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

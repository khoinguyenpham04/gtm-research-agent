import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { ensureDeepResearchDatabase } from "@/lib/deep-research/db";
import {
  moveWorkspaceDocumentRequestSchema,
  moveWorkspaceDocumentToFolder,
} from "@/lib/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; documentId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await ensureDeepResearchDatabase();
    const { id, documentId } = await context.params;
    const payload = moveWorkspaceDocumentRequestSchema.parse(await request.json());
    const workspace = await moveWorkspaceDocumentToFolder(
      id,
      documentId,
      payload.folderId,
      userId,
    );
    return NextResponse.json(workspace);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to move document.";
    const status =
      message === "Workspace not found." ||
      message === "Folder not found in the selected workspace." ||
      message === "Document is not attached to the selected workspace."
        ? 404
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

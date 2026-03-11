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
  try {
    await ensureDeepResearchDatabase();
    const { id, documentId } = await context.params;
    const payload = moveWorkspaceDocumentRequestSchema.parse(await request.json());
    const workspace = await moveWorkspaceDocumentToFolder(
      id,
      documentId,
      payload.folderId,
    );
    return NextResponse.json(workspace);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to move document.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

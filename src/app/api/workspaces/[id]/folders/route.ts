import { NextResponse } from "next/server";

import { ensureDeepResearchDatabase } from "@/lib/deep-research/db";
import {
  createWorkspaceFolder,
  createWorkspaceFolderRequestSchema,
  getWorkspaceDetail,
} from "@/lib/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureDeepResearchDatabase();
    const { id } = await context.params;
    const payload = createWorkspaceFolderRequestSchema.parse(await request.json());
    await createWorkspaceFolder(id, payload);
    const workspace = await getWorkspaceDetail(id);
    return NextResponse.json(workspace);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create folder.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

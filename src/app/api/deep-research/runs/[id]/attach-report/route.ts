import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { listDocumentsByIds } from "@/lib/documents";
import { ensureDeepResearchDatabase } from "@/lib/deep-research/db";
import { getDeepResearchRunRecord } from "@/lib/deep-research/repository";
import { ingestDocumentToLibrary } from "@/lib/document-ingestion";
import {
  attachDocumentsToWorkspace,
  getGeneratedReportSourceByRunId,
} from "@/lib/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function slugifyTitle(value: string) {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base || "deep-research-report";
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await ensureDeepResearchDatabase();
    const { id } = await context.params;
    const run = await getDeepResearchRunRecord(id, userId);

    if (!run) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }

    if (run.status !== "completed") {
      return NextResponse.json(
        { error: "Only completed runs can be added to the workspace knowledge base." },
        { status: 400 },
      );
    }

    if (!run.final_report_markdown?.trim()) {
      return NextResponse.json(
        { error: "This run does not have a final report to publish." },
        { status: 400 },
      );
    }

    if (!run.workspace_id) {
      return NextResponse.json(
        { error: "This run is not attached to a workspace." },
        { status: 400 },
      );
    }

    const existingSource = await getGeneratedReportSourceByRunId(run.id, userId);
    if (existingSource) {
      await attachDocumentsToWorkspace(run.workspace_id, [existingSource.documentId], userId);
      const [document] = await listDocumentsByIds([existingSource.documentId], userId);

      return NextResponse.json(
        {
          alreadyAttached: true,
          document: document ?? null,
        },
        { status: 200 },
      );
    }

    const result = await ingestDocumentToLibrary({
      fileBuffer: Buffer.from(run.final_report_markdown, "utf-8"),
      fileName: `${slugifyTitle(run.topic)}.md`,
      fileType: "text/markdown; charset=utf-8",
      generatedFromRunId: run.id,
      metadata: {
        generatedAt: run.updated_at,
        reportTitle: run.topic,
        runId: run.id,
        sessionId: run.session_id,
        workspaceId: run.workspace_id,
      },
      sourceType: "generated_report",
      workspaceId: run.workspace_id,
      clerkUserId: userId,
    });

    return NextResponse.json(
      {
        alreadyAttached: false,
        document: result.document,
      },
      { status: 201 },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to add report to workspace knowledge base.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

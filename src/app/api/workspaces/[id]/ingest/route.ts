import { NextResponse } from "next/server";

import { ensureDeepResearchDatabase } from "@/lib/deep-research/db";
import { ingestDocumentToLibrary } from "@/lib/document-ingestion";
import { ingestWorkspaceDocumentRequestSchema } from "@/lib/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getFileNameFromUrl(fileUrl: string) {
  try {
    const pathname = new URL(fileUrl).pathname;
    const lastSegment = pathname.split("/").filter(Boolean).at(-1);
    return lastSegment || `download-${Date.now()}.pdf`;
  } catch {
    return `download-${Date.now()}.pdf`;
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureDeepResearchDatabase();
    const { id } = await context.params;
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "No file provided." }, { status: 400 });
      }

      const result = await ingestDocumentToLibrary({
        fileBuffer: Buffer.from(await file.arrayBuffer()),
        fileName: file.name,
        fileType: file.type || undefined,
        workspaceId: id,
        sourceType: "agent_download",
      });

      return NextResponse.json(result, { status: 201 });
    }

    const payload = ingestWorkspaceDocumentRequestSchema.parse(
      await request.json(),
    );
    const response = await fetch(payload.fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to download file from source URL (${response.status}).`);
    }

    const fileType = response.headers.get("content-type") ?? undefined;
    const fileName = getFileNameFromUrl(payload.fileUrl);
    const result = await ingestDocumentToLibrary({
      fileBuffer: Buffer.from(await response.arrayBuffer()),
      fileName,
      fileType,
      workspaceId: id,
      sourceType: "url_ingest",
      sourceUrl: payload.fileUrl,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to ingest document.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

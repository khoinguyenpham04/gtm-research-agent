import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { ensureDeepResearchDatabase } from "@/lib/deep-research/db";
import { ingestDocumentToLibrary } from "@/lib/document-ingestion";
import { ingestWorkspaceDocumentRequestSchema } from "@/lib/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DIRECT_FILE_URL_ERROR =
  "URL import only supports direct PDF, DOCX, or TXT file links.";

type SupportedRemoteFileKind = "pdf" | "docx" | "txt";

function getFileNameFromUrl(fileUrl: string) {
  try {
    const pathname = new URL(fileUrl).pathname;
    const lastSegment = pathname.split("/").filter(Boolean).at(-1);
    return lastSegment || `download-${Date.now()}.pdf`;
  } catch {
    return `download-${Date.now()}.pdf`;
  }
}

function getFileNameFromContentDisposition(value: string | null) {
  if (!value) {
    return null;
  }

  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const fallbackMatch = value.match(/filename="?([^";]+)"?/i);
  return fallbackMatch?.[1] ?? null;
}

function getFileExtension(fileName: string) {
  const lastSegment = fileName.split(".").at(-1)?.trim().toLowerCase();
  return lastSegment && lastSegment !== fileName.toLowerCase()
    ? lastSegment
    : "";
}

function sniffPdf(buffer: Buffer) {
  return buffer.subarray(0, 5).toString("utf-8") === "%PDF-";
}

function sniffDocx(buffer: Buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function sniffHtml(buffer: Buffer) {
  const start = buffer.subarray(0, 256).toString("utf-8").trim().toLowerCase();
  return start.startsWith("<!doctype html") || start.startsWith("<html");
}

function inferFileKind(options: {
  buffer: Buffer;
  mimeType?: string;
  fileName: string;
}): SupportedRemoteFileKind | null {
  const normalizedMimeType = options.mimeType
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  const extension = getFileExtension(options.fileName);

  if (normalizedMimeType === "text/html" || extension === "html" || extension === "htm") {
    throw new Error(DIRECT_FILE_URL_ERROR);
  }

  if (sniffHtml(options.buffer)) {
    throw new Error(DIRECT_FILE_URL_ERROR);
  }

  if (
    normalizedMimeType === "application/pdf" ||
    extension === "pdf" ||
    sniffPdf(options.buffer)
  ) {
    return "pdf";
  }

  if (
    normalizedMimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === "docx" ||
    sniffDocx(options.buffer)
  ) {
    return "docx";
  }

  if (
    normalizedMimeType === "text/plain" ||
    normalizedMimeType === "application/text" ||
    extension === "txt"
  ) {
    return "txt";
  }

  return null;
}

function getNormalizedRemoteFileName(options: {
  requestedUrl: string;
  responseUrl: string;
  contentDisposition: string | null;
  fileKind: SupportedRemoteFileKind;
}) {
  const contentDispositionName = getFileNameFromContentDisposition(
    options.contentDisposition,
  );
  const responseName = getFileNameFromUrl(options.responseUrl);
  const requestedName = getFileNameFromUrl(options.requestedUrl);
  const baseName = contentDispositionName || responseName || requestedName;
  const expectedExtension = options.fileKind;

  if (getFileExtension(baseName) === expectedExtension) {
    return baseName;
  }

  const strippedBaseName = baseName.replace(/\.[^.]+$/, "") || "download";
  return `${strippedBaseName}.${expectedExtension}`;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await ensureDeepResearchDatabase();
    const { id } = await context.params;
    const requestContentType = request.headers.get("content-type") ?? "";

    if (requestContentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "No file provided." }, { status: 400 });
      }

      const result = await ingestDocumentToLibrary({
        clerkUserId: userId,
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

    const fileBuffer = Buffer.from(await response.arrayBuffer());
    const remoteMimeType = response.headers.get("content-type") ?? undefined;
    const fileKind = inferFileKind({
      buffer: fileBuffer,
      mimeType: remoteMimeType,
      fileName:
        getFileNameFromContentDisposition(
          response.headers.get("content-disposition"),
        ) ||
        getFileNameFromUrl(response.url || payload.fileUrl),
    });

    if (!fileKind) {
      throw new Error(DIRECT_FILE_URL_ERROR);
    }

    const fileName = getNormalizedRemoteFileName({
      contentDisposition: response.headers.get("content-disposition"),
      fileKind,
      requestedUrl: payload.fileUrl,
      responseUrl: response.url || payload.fileUrl,
    });
    const fileType =
      fileKind === "pdf"
        ? "application/pdf"
        : fileKind === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "text/plain; charset=utf-8";

    const result = await ingestDocumentToLibrary({
      clerkUserId: userId,
      fileBuffer,
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
    const status = message === "Workspace not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

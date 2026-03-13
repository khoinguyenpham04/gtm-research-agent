import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { ensureDeepResearchDatabase } from '@/lib/deep-research/db';
import { ingestDocumentToLibrary } from '@/lib/document-ingestion';

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await ensureDeepResearchDatabase();
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const workspaceIdValue = formData.get('workspaceId');
    const workspaceId =
      typeof workspaceIdValue === 'string' && workspaceIdValue.trim().length > 0
        ? workspaceIdValue.trim()
        : undefined;

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    const result = await ingestDocumentToLibrary({
      clerkUserId: userId,
      fileBuffer,
      fileName: file.name,
      fileType: file.type || undefined,
      workspaceId,
      sourceType: 'upload',
    });

    return NextResponse.json({
      success: true,
      documentId: result.documentId,
      fileName: result.document.file_name,
      chunks: result.chunks,
      textLength: result.textLength,
      workspaceAttached: result.attachedToWorkspace,
    });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed to process file' }, { status: 500 });
  }
}

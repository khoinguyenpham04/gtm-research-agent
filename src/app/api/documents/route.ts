import { auth } from "@clerk/nextjs/server";
import { NextResponse } from 'next/server';

import { listDocuments } from "@/lib/documents";
import { listWorkspaces } from "@/lib/workspaces";
import { createSupabaseClients } from '@/lib/supabase';

interface DocumentMetadata extends Record<string, unknown> {
  document_id?: string;
  file_name?: string;
  file_type?: string;
  file_size?: number;
  upload_date?: string;
  total_chunks?: number;
  file_url?: string;
  file_path?: string;
}

interface DocumentChunkRow {
  content: string;
  metadata: DocumentMetadata;
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { supabaseAdmin, supabaseStorage } = createSupabaseClients();
    const reqUrl = new URL(req.url);
    const id = reqUrl.searchParams.get('id');
    const file = reqUrl.searchParams.get('file') === 'true';
    const view = reqUrl.searchParams.get('view') === 'true';

    // File download/view
    if (id && file) {
      const { data: documents, error } = await supabaseAdmin
        .from('documents')
        .select('metadata')
        .eq('document_external_id', id)
        .eq('clerk_user_id', userId)
        .limit(1);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      if (!documents || documents.length === 0) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }

      const meta = documents[0].metadata;
      const fileName = meta?.file_name || 'document';
      const fileType = meta?.file_type || 'application/octet-stream';
      const filePath = meta?.file_path || `${id}.${fileName.split('.').pop() || 'pdf'}`;
      const { data: fileData, error: downloadError } = await supabaseStorage.storage.from('documents').download(filePath);
      if (downloadError || !fileData) return NextResponse.json({ error: downloadError?.message || 'File not stored' }, { status: 404 });
      const buffer = Buffer.from(await fileData.arrayBuffer());
      if (buffer.length === 0) return NextResponse.json({ error: 'File is empty' }, { status: 500 });
      const isPDF = fileType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': fileType,
          'Content-Disposition': (view && isPDF) ? `inline; filename="${fileName}"` : `attachment; filename="${fileName}"`,
          'Content-Length': buffer.length.toString(),
          ...(view && isPDF ? { 'X-Content-Type-Options': 'nosniff' } : {}),
        },
      });
    }

    // Single document with text content
    if (id) {
      const { data: chunks, error } = await supabaseAdmin
        .from('documents')
        .select('content, metadata')
        .eq('document_external_id', id)
        .eq('clerk_user_id', userId);

      if (error || !chunks || chunks.length === 0) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }

      const m = chunks[0].metadata || {};
      return NextResponse.json({
        id,
        file_name: m.file_name || 'Unknown',
        file_type: m.file_type || 'unknown',
        file_size: m.file_size || 0,
        upload_date: m.upload_date || new Date().toISOString(),
        total_chunks: chunks.length,
        fullText: (chunks as DocumentChunkRow[]).map((chunk) => chunk.content).join('\n\n'),
        file_path: m.file_path
      });
    }

    // List all documents
    const documents = await listDocuments(userId);
    return NextResponse.json({
      documents,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load documents' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { supabaseAdmin, supabaseStorage } = createSupabaseClients();
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Document ID required' }, { status: 400 });
    const { data: docs, error: documentError } = await supabaseAdmin
      .from('documents')
      .select('metadata')
      .eq('document_external_id', id)
      .eq('clerk_user_id', userId)
      .limit(1);
    if (documentError) return NextResponse.json({ error: documentError.message }, { status: 500 });
    if (!docs || docs.length === 0) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    const filePath = docs?.[0]?.metadata?.file_path;
    if (filePath) await supabaseStorage.storage.from('documents').remove([filePath]);
    const { error } = await supabaseAdmin
      .from('documents')
      .delete()
      .eq('document_external_id', id)
      .eq('clerk_user_id', userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const ownedWorkspaces = await listWorkspaces(userId);
    const ownedWorkspaceIds = ownedWorkspaces.map((workspace) => workspace.id);
    await Promise.all([
      ownedWorkspaceIds.length > 0
        ? supabaseAdmin
            .from('workspace_documents')
            .delete()
            .eq('document_external_id', id)
            .in('workspace_id', ownedWorkspaceIds)
        : Promise.resolve({ error: null }),
      supabaseAdmin
        .from('document_sources')
        .delete()
        .eq('document_external_id', id)
        .eq('clerk_user_id', userId),
    ]);
    return NextResponse.json({ success: true, fileDeleted: !!filePath });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to delete document' }, { status: 500 });
  }
}

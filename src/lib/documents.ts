import { createSupabaseClients } from "@/lib/supabase";

export interface DocumentSummary {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  upload_date: string;
  total_chunks: number;
  file_url?: string;
  file_path?: string;
}

export interface DocumentChunk {
  id: number;
  content: string;
  metadata: Record<string, unknown>;
  embedding?: unknown;
}

type DocumentRow = {
  document_external_id?: string | null;
  clerk_user_id?: string | null;
  metadata: Record<string, unknown> | null;
};

function mapDocumentMetadata(metadata: Record<string, unknown>): DocumentSummary {
  return {
    id: String(metadata.document_id ?? ""),
    file_name: String(metadata.file_name ?? "Unknown"),
    file_type: String(metadata.file_type ?? "unknown"),
    file_size: Number(metadata.file_size ?? 0),
    upload_date: String(metadata.upload_date ?? new Date().toISOString()),
    total_chunks: Number(metadata.total_chunks ?? 0),
    file_path: typeof metadata.file_path === "string" ? metadata.file_path : undefined,
  };
}

export async function listDocuments(clerkUserId?: string): Promise<DocumentSummary[]> {
  const { supabaseAdmin } = createSupabaseClients();
  let query = supabaseAdmin
    .from("documents")
    .select("document_external_id, clerk_user_id, metadata");

  if (clerkUserId) {
    query = query.eq("clerk_user_id", clerkUserId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  const documents = new Map<string, DocumentSummary>();
  for (const row of (data ?? []) as DocumentRow[]) {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    const documentId = row.document_external_id ?? metadata.document_id;
    if (typeof documentId !== "string" || documents.has(documentId)) {
      continue;
    }

    documents.set(documentId, mapDocumentMetadata(metadata));
  }

  return Array.from(documents.values()).sort((left, right) =>
    right.upload_date.localeCompare(left.upload_date),
  );
}

export async function listDocumentsByIds(
  documentIds: string[],
  clerkUserId?: string,
): Promise<DocumentSummary[]> {
  if (documentIds.length === 0) {
    return [];
  }

  const { supabaseAdmin } = createSupabaseClients();
  let query = supabaseAdmin
    .from("documents")
    .select("document_external_id, clerk_user_id, metadata")
    .in("document_external_id", documentIds);

  if (clerkUserId) {
    query = query.eq("clerk_user_id", clerkUserId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  const documents = new Map<string, DocumentSummary>();
  for (const row of (data ?? []) as DocumentRow[]) {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    const documentId = row.document_external_id ?? metadata.document_id;
    if (typeof documentId !== "string" || documents.has(documentId)) {
      continue;
    }

    documents.set(documentId, mapDocumentMetadata(metadata));
  }

  return documentIds
    .map((documentId) => documents.get(documentId) ?? null)
    .filter((document): document is DocumentSummary => document !== null);
}

export async function listDocumentChunksByIds(
  documentIds: string[],
  clerkUserId?: string,
): Promise<DocumentChunk[]> {
  if (documentIds.length === 0) {
    return [];
  }

  const { supabaseAdmin } = createSupabaseClients();
  let query = supabaseAdmin
    .from("documents")
    .select("id, content, metadata, embedding")
    .in("document_external_id", documentIds);

  if (clerkUserId) {
    query = query.eq("clerk_user_id", clerkUserId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as DocumentChunk[];
}

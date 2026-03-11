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

function mapDocumentMetadata(metadata: Record<string, unknown>): DocumentSummary {
  return {
    id: String(metadata.document_id ?? ""),
    file_name: String(metadata.file_name ?? "Unknown"),
    file_type: String(metadata.file_type ?? "unknown"),
    file_size: Number(metadata.file_size ?? 0),
    upload_date: String(metadata.upload_date ?? new Date().toISOString()),
    total_chunks: Number(metadata.total_chunks ?? 0),
    file_url: typeof metadata.file_url === "string" ? metadata.file_url : undefined,
    file_path: typeof metadata.file_path === "string" ? metadata.file_path : undefined,
  };
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  const { supabaseAdmin } = createSupabaseClients();
  const { data, error } = await supabaseAdmin.from("documents").select("metadata");

  if (error) {
    throw new Error(error.message);
  }

  const documents = new Map<string, DocumentSummary>();
  for (const row of data ?? []) {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    const documentId = metadata.document_id;
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
): Promise<DocumentSummary[]> {
  if (documentIds.length === 0) {
    return [];
  }

  const documents = await Promise.all(
    documentIds.map(async (documentId) => {
      const { supabaseAdmin } = createSupabaseClients();
      const { data, error } = await supabaseAdmin
        .from("documents")
        .select("metadata")
        .eq("metadata->>document_id", documentId)
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }

      if (!data?.metadata) {
        return null;
      }

      return mapDocumentMetadata(data.metadata as Record<string, unknown>);
    }),
  );

  return documents.filter((document): document is DocumentSummary => document !== null);
}

export async function listDocumentChunksByIds(
  documentIds: string[],
): Promise<DocumentChunk[]> {
  if (documentIds.length === 0) {
    return [];
  }

  const { supabaseAdmin } = createSupabaseClients();
  const chunkSets = await Promise.all(
    documentIds.map(async (documentId) => {
      const { data, error } = await supabaseAdmin
        .from("documents")
        .select("id, content, metadata, embedding")
        .eq("metadata->>document_id", documentId);

      if (error) {
        throw new Error(error.message);
      }

      return (data ?? []) as DocumentChunk[];
    }),
  );

  return chunkSets.flat();
}

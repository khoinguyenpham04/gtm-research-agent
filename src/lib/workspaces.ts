import { z } from "zod";

import type { DocumentSummary } from "@/lib/documents";
import { listDocuments, listDocumentsByIds } from "@/lib/documents";
import { createSupabaseClients } from "@/lib/supabase";

export const createWorkspaceRequestSchema = z.object({
  name: z.string().trim().min(1, "Workspace name is required."),
  description: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export const attachWorkspaceDocumentsRequestSchema = z.object({
  documentIds: z.array(z.string().trim().min(1)).min(1),
});

export const createWorkspaceFolderRequestSchema = z.object({
  name: z.string().trim().min(1, "Folder name is required."),
  parentFolderId: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export const moveWorkspaceDocumentRequestSchema = z.object({
  folderId: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((value) => (value ? value : null)),
});

export const ingestWorkspaceDocumentRequestSchema = z.object({
  fileUrl: z.string().url("Provide a valid file URL."),
});

export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;
export type AttachWorkspaceDocumentsRequest = z.infer<
  typeof attachWorkspaceDocumentsRequestSchema
>;
export type CreateWorkspaceFolderRequest = z.infer<
  typeof createWorkspaceFolderRequestSchema
>;
export type MoveWorkspaceDocumentRequest = z.infer<
  typeof moveWorkspaceDocumentRequestSchema
>;
export type IngestWorkspaceDocumentRequest = z.infer<
  typeof ingestWorkspaceDocumentRequestSchema
>;

interface WorkspaceRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface WorkspaceFolderRow {
  id: string;
  workspace_id: string;
  name: string;
  parent_folder_id: string | null;
  created_at: string;
  updated_at: string;
}

interface WorkspaceDocumentRow {
  workspace_id: string;
  document_external_id: string;
  folder_id: string | null;
  created_at: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  description?: string;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceFolder {
  id: string;
  workspaceId: string;
  name: string;
  parentFolderId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceDocumentAttachment {
  workspaceId: string;
  documentId: string;
  folderId?: string;
  attachedAt: string;
  document: DocumentSummary;
}

export interface WorkspaceFolderNode extends WorkspaceFolder {
  children: WorkspaceFolderNode[];
  documents: WorkspaceDocumentAttachment[];
}

export interface WorkspaceDetail extends WorkspaceSummary {
  folders: WorkspaceFolder[];
  documents: WorkspaceDocumentAttachment[];
  rootDocuments: WorkspaceDocumentAttachment[];
  folderTree: WorkspaceFolderNode[];
}

function mapWorkspaceSummary(
  row: WorkspaceRow,
  documentCount: number,
): WorkspaceSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    documentCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWorkspaceFolder(row: WorkspaceFolderRow): WorkspaceFolder {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    parentFolderId: row.parent_folder_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function buildWorkspaceFolderTree(
  folders: WorkspaceFolder[],
  documents: WorkspaceDocumentAttachment[],
) {
  const nodes = new Map<string, WorkspaceFolderNode>(
    folders.map((folder) => [
      folder.id,
      {
        ...folder,
        children: [],
        documents: [],
      },
    ]),
  );

  const rootDocuments: WorkspaceDocumentAttachment[] = [];

  for (const document of documents) {
    if (!document.folderId) {
      rootDocuments.push(document);
      continue;
    }

    const folder = nodes.get(document.folderId);
    if (!folder) {
      rootDocuments.push({ ...document, folderId: undefined });
      continue;
    }

    folder.documents.push(document);
  }

  const rootFolders: WorkspaceFolderNode[] = [];
  for (const node of nodes.values()) {
    if (node.parentFolderId && nodes.has(node.parentFolderId)) {
      nodes.get(node.parentFolderId)?.children.push(node);
      continue;
    }

    rootFolders.push(node);
  }

  const sortDocuments = (items: WorkspaceDocumentAttachment[]) =>
    items.sort((left, right) =>
      left.document.file_name.localeCompare(right.document.file_name),
    );
  const sortNodes = (items: WorkspaceFolderNode[]) =>
    items.sort((left, right) => left.name.localeCompare(right.name));

  sortDocuments(rootDocuments);
  const visit = (nodesToSort: WorkspaceFolderNode[]) => {
    sortNodes(nodesToSort);
    for (const node of nodesToSort) {
      sortDocuments(node.documents);
      visit(node.children);
    }
  };
  visit(rootFolders);

  return {
    rootDocuments,
    folderTree: rootFolders,
  };
}

export function findInvalidWorkspaceDocumentSelections(
  attachedDocumentIds: string[],
  selectedDocumentIds: string[],
) {
  const attachedIds = new Set(attachedDocumentIds);
  return selectedDocumentIds.filter((documentId) => !attachedIds.has(documentId));
}

async function getWorkspaceRow(workspaceId: string) {
  const { supabaseAdmin } = createSupabaseClients();
  const { data, error } = await supabaseAdmin
    .from("workspaces")
    .select("id, name, description, created_at, updated_at")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as WorkspaceRow | null) ?? null;
}

async function touchWorkspace(workspaceId: string) {
  const { supabaseAdmin } = createSupabaseClients();
  const { error } = await supabaseAdmin
    .from("workspaces")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", workspaceId);

  if (error) {
    throw new Error(error.message);
  }
}

async function listWorkspaceDocumentRows(workspaceId: string) {
  const { supabaseAdmin } = createSupabaseClients();
  const { data, error } = await supabaseAdmin
    .from("workspace_documents")
    .select("workspace_id, document_external_id, folder_id, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as WorkspaceDocumentRow[];
}

async function listWorkspaceFolders(workspaceId: string) {
  const { supabaseAdmin } = createSupabaseClients();
  const { data, error } = await supabaseAdmin
    .from("workspace_folders")
    .select("id, workspace_id, name, parent_folder_id, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as WorkspaceFolderRow[]).map(mapWorkspaceFolder);
}

function toWorkspaceDocumentAttachments(
  rows: WorkspaceDocumentRow[],
  documents: DocumentSummary[],
): WorkspaceDocumentAttachment[] {
  const documentsById = new Map(documents.map((document) => [document.id, document]));

  return rows
    .map((row) => {
      const document = documentsById.get(row.document_external_id);
      if (!document) {
        return null;
      }

      return {
        workspaceId: row.workspace_id,
        documentId: row.document_external_id,
        folderId: row.folder_id ?? undefined,
        attachedAt: row.created_at,
        document,
      } satisfies WorkspaceDocumentAttachment;
    })
    .filter((item): item is WorkspaceDocumentAttachment => item !== null);
}

export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  const { supabaseAdmin } = createSupabaseClients();
  const [{ data, error }, { data: documentRows, error: documentError }] =
    await Promise.all([
      supabaseAdmin
        .from("workspaces")
        .select("id, name, description, created_at, updated_at")
        .order("updated_at", { ascending: false }),
      supabaseAdmin
        .from("workspace_documents")
        .select("workspace_id"),
    ]);

  if (error) {
    throw new Error(error.message);
  }

  if (documentError) {
    throw new Error(documentError.message);
  }

  const counts = new Map<string, number>();
  for (const row of (documentRows ?? []) as { workspace_id: string }[]) {
    counts.set(row.workspace_id, (counts.get(row.workspace_id) ?? 0) + 1);
  }

  return ((data ?? []) as WorkspaceRow[]).map((row) =>
    mapWorkspaceSummary(row, counts.get(row.id) ?? 0),
  );
}

export async function createWorkspace(input: CreateWorkspaceRequest) {
  const { supabaseAdmin } = createSupabaseClients();
  const timestamp = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("workspaces")
    .insert({
      id: crypto.randomUUID(),
      name: input.name,
      description: input.description ?? null,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .select("id, name, description, created_at, updated_at")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapWorkspaceSummary(data as WorkspaceRow, 0);
}

export async function getWorkspaceDetail(workspaceId: string) {
  const workspace = await getWorkspaceRow(workspaceId);
  if (!workspace) {
    return null;
  }

  const [documentRows, folders] = await Promise.all([
    listWorkspaceDocumentRows(workspaceId),
    listWorkspaceFolders(workspaceId),
  ]);
  const documents = await listDocumentsByIds(
    documentRows.map((row) => row.document_external_id),
  );
  const attachments = toWorkspaceDocumentAttachments(documentRows, documents);
  const tree = buildWorkspaceFolderTree(folders, attachments);

  return {
    ...mapWorkspaceSummary(workspace, attachments.length),
    folders,
    documents: attachments,
    rootDocuments: tree.rootDocuments,
    folderTree: tree.folderTree,
  } satisfies WorkspaceDetail;
}

export async function attachDocumentsToWorkspace(
  workspaceId: string,
  documentIds: string[],
) {
  const workspace = await getWorkspaceRow(workspaceId);
  if (!workspace) {
    throw new Error("Workspace not found.");
  }

  const allDocuments = await listDocuments();
  const availableIds = new Set(allDocuments.map((document) => document.id));
  const missing = documentIds.filter((documentId) => !availableIds.has(documentId));
  if (missing.length > 0) {
    throw new Error(
      "One or more selected documents could not be found in the global library.",
    );
  }

  const { supabaseAdmin } = createSupabaseClients();
  const { error } = await supabaseAdmin
    .from("workspace_documents")
    .upsert(
      documentIds.map((documentId) => ({
        workspace_id: workspaceId,
        document_external_id: documentId,
        folder_id: null,
      })),
      {
        onConflict: "workspace_id,document_external_id",
        ignoreDuplicates: false,
      },
    );

  if (error) {
    throw new Error(error.message);
  }

  await touchWorkspace(workspaceId);
  return getWorkspaceDetail(workspaceId);
}

export async function createWorkspaceFolder(
  workspaceId: string,
  input: CreateWorkspaceFolderRequest,
) {
  const workspace = await getWorkspaceRow(workspaceId);
  if (!workspace) {
    throw new Error("Workspace not found.");
  }

  if (input.parentFolderId) {
    const parent = (await listWorkspaceFolders(workspaceId)).find(
      (folder) => folder.id === input.parentFolderId,
    );
    if (!parent) {
      throw new Error("Parent folder not found in the selected workspace.");
    }
  }

  const { supabaseAdmin } = createSupabaseClients();
  const timestamp = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("workspace_folders")
    .insert({
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      name: input.name,
      parent_folder_id: input.parentFolderId ?? null,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .select("id, workspace_id, name, parent_folder_id, created_at, updated_at")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await touchWorkspace(workspaceId);
  return mapWorkspaceFolder(data as WorkspaceFolderRow);
}

export async function moveWorkspaceDocumentToFolder(
  workspaceId: string,
  documentId: string,
  folderId: string | null,
) {
  const workspace = await getWorkspaceRow(workspaceId);
  if (!workspace) {
    throw new Error("Workspace not found.");
  }

  if (folderId) {
    const folder = (await listWorkspaceFolders(workspaceId)).find(
      (item) => item.id === folderId,
    );
    if (!folder) {
      throw new Error("Folder not found in the selected workspace.");
    }
  }

  const { supabaseAdmin } = createSupabaseClients();
  const { data: attachment, error: attachmentError } = await supabaseAdmin
    .from("workspace_documents")
    .select("workspace_id, document_external_id")
    .eq("workspace_id", workspaceId)
    .eq("document_external_id", documentId)
    .maybeSingle();

  if (attachmentError) {
    throw new Error(attachmentError.message);
  }

  if (!attachment) {
    throw new Error("Document is not attached to the selected workspace.");
  }

  const { error } = await supabaseAdmin
    .from("workspace_documents")
    .update({ folder_id: folderId })
    .eq("workspace_id", workspaceId)
    .eq("document_external_id", documentId);

  if (error) {
    throw new Error(error.message);
  }

  await touchWorkspace(workspaceId);
  return getWorkspaceDetail(workspaceId);
}

export async function assertWorkspaceDocumentSelection(
  workspaceId: string,
  selectedDocumentIds: string[],
) {
  const workspace = await getWorkspaceRow(workspaceId);
  if (!workspace) {
    throw new Error("Workspace not found.");
  }

  const rows = await listWorkspaceDocumentRows(workspaceId);
  const invalidDocumentIds = findInvalidWorkspaceDocumentSelections(
    rows.map((row) => row.document_external_id),
    selectedDocumentIds,
  );

  if (invalidDocumentIds.length > 0) {
    throw new Error(
      "Selected documents must already be attached to the active workspace.",
    );
  }

  return workspace;
}

export async function recordDocumentSource(
  input: {
    documentId: string;
    sourceType: "upload" | "agent_download" | "url_ingest" | "generated_report";
    sourceUrl?: string;
    generatedFromRunId?: string;
    metadata?: Record<string, unknown>;
    status?: "ready" | "processing" | "failed";
  },
) {
  const { supabaseAdmin } = createSupabaseClients();
  const timestamp = new Date().toISOString();
  const { error } = await supabaseAdmin.from("document_sources").upsert(
    {
      document_external_id: input.documentId,
      source_type: input.sourceType,
      source_url: input.sourceUrl ?? null,
      generated_from_run_id: input.generatedFromRunId ?? null,
      status: input.status ?? "ready",
      metadata_json: input.metadata ?? {},
      updated_at: timestamp,
      created_at: timestamp,
    },
    {
      onConflict: "document_external_id",
      ignoreDuplicates: false,
    },
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function getGeneratedReportSourceByRunId(runId: string) {
  const { supabaseAdmin } = createSupabaseClients();
  const { data, error } = await supabaseAdmin
    .from("document_sources")
    .select(
      "document_external_id, metadata_json, source_type, source_url, generated_from_run_id, updated_at, created_at",
    )
    .eq("generated_from_run_id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  return {
    documentId: data.document_external_id as string,
    metadata: (data.metadata_json ?? {}) as Record<string, unknown>,
    sourceType: data.source_type as
      | "upload"
      | "agent_download"
      | "url_ingest"
      | "generated_report",
    sourceUrl:
      typeof data.source_url === "string" ? (data.source_url as string) : undefined,
    generatedFromRunId:
      typeof data.generated_from_run_id === "string"
        ? (data.generated_from_run_id as string)
        : undefined,
    updatedAt: data.updated_at as string,
    createdAt: data.created_at as string,
  };
}

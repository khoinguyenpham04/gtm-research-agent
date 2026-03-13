import OpenAI from "openai";

import type { WorkspaceDetail } from "@/lib/workspaces";
import { getWorkspaceDetail } from "@/lib/workspaces";
import { createSupabaseClients } from "@/lib/supabase";
import {
  getRequiredOpenAiApiKey,
  getWorkspaceChatModel,
} from "@/lib/deep-research/config";
import {
  appendSessionMessage,
  getSessionSummary,
  listRecentSessionChatMessages,
} from "@/lib/deep-research/repository";
import type {
  SearchMatch,
  SessionRole,
  WorkspaceChatCitation,
  WorkspaceChatMessageMetadata,
} from "@/lib/deep-research/types";
import type { WorkspaceDocumentAttachment } from "@/lib/workspaces";

const WORKSPACE_CHAT_HISTORY_LIMIT = 12;
const WORKSPACE_CHAT_DOCUMENT_MATCH_COUNT = 5;
const WORKSPACE_CHAT_CONTEXT_CHAR_BUDGET = 7200;

export type WorkspaceChatHistoryTurn = {
  content: string;
  role: SessionRole;
};

type ResolvedWorkspaceChatScope = {
  attachmentByDocumentId: Map<string, WorkspaceDocumentAttachment>;
  effectiveDocumentIds: string[];
  requestedDocumentIds: string[];
  workspace: WorkspaceDetail;
};

export type PreparedWorkspaceChatTurn = {
  assistantMetadata: WorkspaceChatMessageMetadata;
  historyTurns: WorkspaceChatHistoryTurn[];
  userMessageId: string;
  userText: string;
  workspace: WorkspaceDetail;
};

function normalizeExcerpt(text: string, maxLength = 420) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trim()}...`;
}

function buildDocumentCitation(
  match: SearchMatch,
  attachment?: WorkspaceDocumentAttachment,
): WorkspaceChatCitation {
  const fileName =
    typeof match.metadata.file_name === "string"
      ? match.metadata.file_name
      : "Workspace document";
  const documentId =
    typeof match.metadata.document_id === "string"
      ? match.metadata.document_id
      : undefined;
  const fileType =
    typeof match.metadata.file_type === "string"
      ? match.metadata.file_type
      : undefined;
  const chunkIndex =
    typeof match.metadata.chunk_index === "number"
      ? match.metadata.chunk_index
      : typeof match.metadata.chunk_index === "string"
        ? Number.parseInt(match.metadata.chunk_index, 10)
        : undefined;
  const totalChunks =
    typeof match.metadata.total_chunks === "number"
      ? match.metadata.total_chunks
      : typeof match.metadata.total_chunks === "string"
        ? Number.parseInt(match.metadata.total_chunks, 10)
        : undefined;
  const isGeneratedReport = attachment?.assetType === "generated_report";
  const title =
    isGeneratedReport
      ? attachment?.generatedReport?.title || fileName
      : fileName;

  return {
    id: `doc:${match.id}`,
    sourceType: isGeneratedReport ? "generated_report" : "uploaded_document",
    title,
    excerpt: normalizeExcerpt(match.content),
    locationLabel:
      typeof chunkIndex === "number"
        ? `Chunk ${chunkIndex + 1}${
            typeof totalChunks === "number" && totalChunks > 0
              ? ` of ${totalChunks}`
              : ""
          }`
        : isGeneratedReport
          ? "Generated report"
          : "Workspace document",
    url: documentId
      ? `/api/documents?id=${documentId}&file=true${
          fileType === "application/pdf" ||
          fileName.toLowerCase().endsWith(".pdf")
            ? "&view=true"
            : ""
        }`
      : undefined,
    documentId,
    fileName,
    chunkIndex: typeof chunkIndex === "number" ? chunkIndex : undefined,
    totalChunks:
      typeof totalChunks === "number" && Number.isFinite(totalChunks)
        ? totalChunks
        : undefined,
    similarity: Number.isFinite(match.similarity) ? match.similarity : undefined,
  };
}

async function embedQuery(query: string, apiKey: string) {
  const openai = new OpenAI({ apiKey });
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: query,
  });

  return response.data[0]?.embedding ?? [];
}

async function searchWorkspaceDocuments(
  query: string,
  selectedDocumentIds: string[],
  apiKey: string,
) {
  if (selectedDocumentIds.length === 0) {
    return [] as SearchMatch[];
  }

  const embedding = await embedQuery(query, apiKey);
  const { supabaseAdmin } = createSupabaseClients();
  const { data, error } = await supabaseAdmin.rpc("match_documents", {
    query_embedding: embedding,
    match_threshold: 0,
    match_count: WORKSPACE_CHAT_DOCUMENT_MATCH_COUNT,
    selected_document_ids: selectedDocumentIds,
  });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as SearchMatch[];
}

export function buildWorkspaceChatContextBlock(
  citations: WorkspaceChatCitation[],
) {
  if (citations.length === 0) {
    return "No relevant workspace knowledge was retrieved for this question.";
  }

  const lines: string[] = [];
  let characterCount = 0;

  citations.forEach((citation, index) => {
    const block = [
      `[Source ${index + 1}] ${
        citation.sourceType === "generated_report" ||
        citation.sourceType === "research_report"
          ? "Generated report"
          : "Workspace document"
      }: ${citation.title}`,
      citation.locationLabel ? `Location: ${citation.locationLabel}` : null,
      citation.excerpt,
    ]
      .filter(Boolean)
      .join("\n");

    if (characterCount + block.length > WORKSPACE_CHAT_CONTEXT_CHAR_BUDGET) {
      return;
    }

    lines.push(block);
    characterCount += block.length;
  });

  return lines.join("\n\n");
}

function buildRetrievalScopeLabel(args: {
  requestedDocumentIds: string[];
  effectiveDocumentIds: string[];
  workspaceName: string;
}) {
  const selectionLabel =
    args.requestedDocumentIds.length > 0
      ? `${args.requestedDocumentIds.length} selected workspace asset${
          args.requestedDocumentIds.length === 1 ? "" : "s"
        }`
      : `${args.effectiveDocumentIds.length} attached workspace asset${
          args.effectiveDocumentIds.length === 1 ? "" : "s"
        }`;

  return `Searched ${selectionLabel} in ${args.workspaceName}.`;
}

function buildRetrievalTraceMarkdown(args: {
  citations: WorkspaceChatCitation[];
  effectiveDocumentIds: string[];
  requestedDocumentIds: string[];
  workspaceName: string;
}) {
  const scopeLabel = buildRetrievalScopeLabel(args);
  if (args.citations.length === 0) {
    return [
      scopeLabel,
      "",
      "- No relevant workspace knowledge matched this question.",
    ].join("\n");
  }

  const uniqueSources = new Map<string, WorkspaceChatCitation>();
  args.citations.forEach((citation) => {
    const key = citation.documentId ?? citation.id;
    if (!uniqueSources.has(key)) {
      uniqueSources.set(key, citation);
    }
  });

  const lines = [
    scopeLabel,
    "",
    `- Retrieved ${args.citations.length} supporting chunk${
      args.citations.length === 1 ? "" : "s"
    }.`,
    "- Top matches:",
    ...Array.from(uniqueSources.values())
      .slice(0, 5)
      .map((citation) => {
        const kind =
          citation.sourceType === "generated_report" ||
          citation.sourceType === "research_report"
            ? "Generated report"
            : "Workspace document";
        return `  - ${kind}: ${citation.title}${
          citation.locationLabel ? ` (${citation.locationLabel})` : ""
        }`;
      }),
  ];

  return lines.join("\n");
}

async function resolveWorkspaceContext(
  sessionId: string,
  requestedDocumentIds: string[],
  clerkUserId: string,
): Promise<ResolvedWorkspaceChatScope> {
  const session = await getSessionSummary(sessionId, clerkUserId);
  if (!session) {
    throw new Error("Session not found.");
  }

  const workspace = await getWorkspaceDetail(session.workspaceId, clerkUserId);
  if (!workspace) {
    throw new Error("Workspace not found.");
  }

  const attachedDocumentIds = workspace.documents.map(
    (attachment) => attachment.documentId,
  );
  const invalidDocumentIds = requestedDocumentIds.filter(
    (documentId) => !attachedDocumentIds.includes(documentId),
  );

  if (invalidDocumentIds.length > 0) {
    throw new Error("Selected documents must belong to the session workspace.");
  }

  const effectiveDocumentIds =
    requestedDocumentIds.length > 0 ? requestedDocumentIds : attachedDocumentIds;
  const attachmentByDocumentId = new Map(
    workspace.documents.map((attachment) => [attachment.documentId, attachment]),
  );

  return {
    attachmentByDocumentId,
    effectiveDocumentIds,
    requestedDocumentIds,
    workspace,
  };
}

function buildHistoryTurns(
  recentChatMessages: Array<{
    content_markdown: string;
    role: SessionRole;
  }>,
): WorkspaceChatHistoryTurn[] {
  return recentChatMessages
    .map((message) => ({
      content: message.content_markdown.trim(),
      role: message.role,
    }))
    .filter((message) => message.content.length > 0);
}

export async function prepareWorkspaceChatTurn(input: {
  clerkUserId: string;
  selectedDocumentIds: string[];
  sessionId: string;
  text: string;
  userMessageId?: string;
}) : Promise<PreparedWorkspaceChatTurn> {
  const userText = input.text.trim();
  if (!userText) {
    throw new Error("Chat messages must include text content.");
  }

  const apiKey = getRequiredOpenAiApiKey();
  const {
    attachmentByDocumentId,
    effectiveDocumentIds,
    requestedDocumentIds,
    workspace,
  } = await resolveWorkspaceContext(
    input.sessionId,
    input.selectedDocumentIds,
    input.clerkUserId,
  );

  const userMessageId = await appendSessionMessage({
    id: input.userMessageId,
    sessionId: input.sessionId,
    role: "user",
    messageType: "chat",
    contentMarkdown: userText,
    metadata: {
      mode: "workspace_chat",
      selectedDocumentIds: requestedDocumentIds,
      citations: [],
      sources: [],
      model: getWorkspaceChatModel(),
      retrievedGeneratedReportCount: 0,
      retrievedUploadedDocumentCount: 0,
      sourceCount: 0,
      traceEvents: [],
      createdAt: new Date().toISOString(),
    },
    clerkUserId: input.clerkUserId,
  });

  const [documentMatches, recentChatMessages] = await Promise.all([
    searchWorkspaceDocuments(userText, effectiveDocumentIds, apiKey),
    listRecentSessionChatMessages(
      input.sessionId,
      WORKSPACE_CHAT_HISTORY_LIMIT,
      input.clerkUserId,
    ),
  ]);

  const citations = documentMatches
    .map((match) =>
      buildDocumentCitation(
        match,
        typeof match.metadata.document_id === "string"
          ? attachmentByDocumentId.get(match.metadata.document_id)
          : undefined,
      ),
    )
    .slice(0, WORKSPACE_CHAT_DOCUMENT_MATCH_COUNT);

  const uniqueRetrievedAssetIds = new Set(
    citations
      .map((citation) => citation.documentId)
      .filter((documentId): documentId is string => Boolean(documentId)),
  );
  let retrievedGeneratedReportCount = 0;
  let retrievedUploadedDocumentCount = 0;

  uniqueRetrievedAssetIds.forEach((documentId) => {
    const attachment = attachmentByDocumentId.get(documentId);
    if (attachment?.assetType === "generated_report") {
      retrievedGeneratedReportCount += 1;
      return;
    }

    retrievedUploadedDocumentCount += 1;
  });

  return {
    assistantMetadata: {
      mode: "workspace_chat",
      selectedDocumentIds: requestedDocumentIds,
      citations,
      sources: citations,
      model: getWorkspaceChatModel(),
      retrievalScopeLabel: buildRetrievalScopeLabel({
        effectiveDocumentIds,
        requestedDocumentIds,
        workspaceName: workspace.name,
      }),
      retrievalTraceMarkdown: buildRetrievalTraceMarkdown({
        citations,
        effectiveDocumentIds,
        requestedDocumentIds,
        workspaceName: workspace.name,
      }),
      retrievedGeneratedReportCount,
      retrievedUploadedDocumentCount,
      sourceCount: citations.length,
      traceEvents: [],
      createdAt: new Date().toISOString(),
    },
    historyTurns: buildHistoryTurns(recentChatMessages),
    userMessageId,
    userText,
    workspace,
  };
}

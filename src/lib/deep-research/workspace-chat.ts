import type { UIMessage } from "ai";
import { convertToModelMessages, streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import OpenAI from "openai";

import type { WorkspaceDetail } from "@/lib/workspaces";
import { getWorkspaceDetail } from "@/lib/workspaces";
import { createSupabaseClients } from "@/lib/supabase";
import {
  getRequiredOpenAiApiKey,
  getWorkspaceChatMaxOutputTokens,
  getWorkspaceChatModel,
} from "@/lib/deep-research/config";
import {
  appendSessionMessage,
  getSessionSummary,
  listCompletedSessionReports,
  listRecentSessionChatMessages,
  type SessionCompletedReport,
} from "@/lib/deep-research/repository";
import type {
  SearchMatch,
  WorkspaceChatCitation,
  WorkspaceChatMessageMetadata,
  WorkspaceChatUIMessage,
} from "@/lib/deep-research/types";

const WORKSPACE_CHAT_HISTORY_LIMIT = 12;
const WORKSPACE_CHAT_DOCUMENT_MATCH_COUNT = 5;
const WORKSPACE_CHAT_REPORT_MATCH_COUNT = 3;
const WORKSPACE_CHAT_CONTEXT_CHAR_BUDGET = 7200;

type ReportExcerpt = {
  id: string;
  runId: string;
  runTopic: string;
  sectionTitle?: string;
  excerpt: string;
  score: number;
  updatedAt: string;
};

type WorkspaceChatContext = {
  assistantMetadata: WorkspaceChatMessageMetadata;
  historyMessages: WorkspaceChatUIMessage[];
  workspace: WorkspaceDetail;
};

function extractMessageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}

function buildUiMessageFromSessionMessage(message: {
  id: string;
  role: "user" | "assistant" | "system";
  content_markdown: string;
  metadata_json: WorkspaceChatMessageMetadata | Record<string, unknown>;
}): WorkspaceChatUIMessage {
  return {
    id: message.id,
    role: message.role,
    metadata:
      typeof message.metadata_json === "object" && message.metadata_json
        ? (message.metadata_json as WorkspaceChatMessageMetadata)
        : undefined,
    parts: [
      {
        type: "text",
        text: message.content_markdown,
      },
    ],
  };
}

function normalizeExcerpt(text: string, maxLength = 420) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trim()}...`;
}

function tokenize(text: string) {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .match(/[a-z0-9]{3,}/g)
        ?.filter((token) => token.length > 2) ?? [],
    ),
  );
}

function scoreTextRelevance(query: string, candidate: string) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return 0;
  }

  const candidateTokens = new Set(tokenize(candidate));
  let overlap = 0;

  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / queryTokens.length;
}

function splitReportIntoExcerpts(report: SessionCompletedReport) {
  const sections = report.finalReportMarkdown
    .split(/\n(?=#{1,3}\s)/g)
    .map((section) => section.trim())
    .filter(Boolean);

  const excerpts: Array<Omit<ReportExcerpt, "score">> = [];
  const sourceSections = sections.length > 0 ? sections : [report.finalReportMarkdown];

  sourceSections.forEach((section, sectionIndex) => {
    const headingMatch = section.match(/^#{1,3}\s+(.+)$/m);
    const sectionTitle = headingMatch?.[1]?.trim();
    const paragraphBlocks = section
      .replace(/^#{1,3}\s+.+$/m, "")
      .split(/\n\s*\n/g)
      .map((block) => block.trim())
      .filter((block) => block.length > 0);

    const blocks = paragraphBlocks.length > 0 ? paragraphBlocks : [section];
    blocks.forEach((block, blockIndex) => {
      const excerpt = normalizeExcerpt(block, 500);
      if (!excerpt) {
        return;
      }

      excerpts.push({
        id: `${report.runId}:${sectionIndex}:${blockIndex}`,
        runId: report.runId,
        runTopic: report.topic,
        sectionTitle,
        excerpt,
        updatedAt: report.updatedAt,
      });
    });
  });

  return excerpts;
}

function rankReportExcerpts(query: string, reports: SessionCompletedReport[]) {
  return reports
    .flatMap(splitReportIntoExcerpts)
    .map((excerpt) => ({
      ...excerpt,
      score: scoreTextRelevance(query, `${excerpt.runTopic}\n${excerpt.sectionTitle ?? ""}\n${excerpt.excerpt}`),
    }))
    .filter((excerpt) => excerpt.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.updatedAt.localeCompare(left.updatedAt);
    })
    .slice(0, WORKSPACE_CHAT_REPORT_MATCH_COUNT);
}

function buildDocumentCitation(match: SearchMatch): WorkspaceChatCitation {
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

  return {
    id: `doc:${match.id}`,
    sourceType: "workspace_document",
    title: fileName,
    excerpt: normalizeExcerpt(match.content),
    locationLabel:
      typeof chunkIndex === "number"
        ? `Chunk ${chunkIndex + 1}${typeof totalChunks === "number" && totalChunks > 0 ? ` of ${totalChunks}` : ""}`
        : "Workspace document",
    url: documentId
      ? `/api/documents?id=${documentId}&file=true${
          fileType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")
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

function buildReportCitation(excerpt: ReportExcerpt): WorkspaceChatCitation {
  return {
    id: `report:${excerpt.id}`,
    sourceType: "research_report",
    title: excerpt.runTopic,
    excerpt: excerpt.excerpt,
    locationLabel: excerpt.sectionTitle ? `Section: ${excerpt.sectionTitle}` : "Final report",
    runId: excerpt.runId,
    runTopic: excerpt.runTopic,
    sectionTitle: excerpt.sectionTitle,
    similarity: excerpt.score,
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

function buildContextBlock(citations: WorkspaceChatCitation[]) {
  if (citations.length === 0) {
    return "No relevant workspace documents or completed research reports were retrieved for this question.";
  }

  const lines: string[] = [];
  let characterCount = 0;

  citations.forEach((citation, index) => {
    const block = [
      `[Source ${index + 1}] ${citation.sourceType === "workspace_document" ? "Workspace doc" : "Research report"}: ${citation.title}`,
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

async function resolveWorkspaceContext(
  sessionId: string,
  requestedDocumentIds: string[],
  clerkUserId: string,
) {
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
    throw new Error(
      "Selected documents must belong to the session workspace.",
    );
  }

  const effectiveDocumentIds =
    requestedDocumentIds.length > 0 ? requestedDocumentIds : attachedDocumentIds;

  return {
    effectiveDocumentIds,
    session,
    workspace,
  };
}

export async function buildWorkspaceChatContext(input: {
  sessionId: string;
  requestMessages: WorkspaceChatUIMessage[];
  selectedDocumentIds: string[];
  clerkUserId: string;
}) : Promise<WorkspaceChatContext> {
  const latestUserMessage = [...input.requestMessages]
    .reverse()
    .find((message) => message.role === "user");

  if (!latestUserMessage) {
    throw new Error("A user chat message is required.");
  }

  const userText = extractMessageText(latestUserMessage);
  if (!userText) {
    throw new Error("Chat messages must include text content.");
  }

  const apiKey = getRequiredOpenAiApiKey();
  const { effectiveDocumentIds, workspace } = await resolveWorkspaceContext(
    input.sessionId,
    input.selectedDocumentIds,
    input.clerkUserId,
  );

  await appendSessionMessage({
    id: latestUserMessage.id,
    sessionId: input.sessionId,
    role: "user",
    messageType: "chat",
    contentMarkdown: userText,
    metadata: {
      mode: "workspace_chat",
      selectedDocumentIds: input.selectedDocumentIds,
      citations: [],
      sourceCount: 0,
      createdAt: new Date().toISOString(),
    },
    clerkUserId: input.clerkUserId,
  });

  const [documentMatches, recentChatMessages, completedReports] = await Promise.all([
    searchWorkspaceDocuments(userText, effectiveDocumentIds, apiKey),
    listRecentSessionChatMessages(
      input.sessionId,
      WORKSPACE_CHAT_HISTORY_LIMIT,
      input.clerkUserId,
    ),
    listCompletedSessionReports(input.sessionId, input.clerkUserId),
  ]);

  const reportExcerpts = rankReportExcerpts(userText, completedReports);
  const citations = [
    ...documentMatches.map(buildDocumentCitation),
    ...reportExcerpts.map(buildReportCitation),
  ].slice(0, WORKSPACE_CHAT_DOCUMENT_MATCH_COUNT + WORKSPACE_CHAT_REPORT_MATCH_COUNT);

  const historyMessages = recentChatMessages.map(buildUiMessageFromSessionMessage);

  return {
    assistantMetadata: {
      mode: "workspace_chat",
      selectedDocumentIds: input.selectedDocumentIds,
      citations,
      model: getWorkspaceChatModel(),
      sourceCount: citations.length,
      createdAt: new Date().toISOString(),
    },
    historyMessages,
    workspace,
  };
}

export async function streamWorkspaceChat(input: {
  sessionId: string;
  requestMessages: WorkspaceChatUIMessage[];
  selectedDocumentIds: string[];
  clerkUserId: string;
  signal?: AbortSignal;
}) {
  const latestUserMessage = [...input.requestMessages]
    .reverse()
    .find((message) => message.role === "user");

  if (!latestUserMessage) {
    throw new Error("A user chat message is required.");
  }

  const userText = extractMessageText(latestUserMessage);
  if (!userText) {
    throw new Error("Chat messages must include text content.");
  }

  const { assistantMetadata, historyMessages, workspace } =
    await buildWorkspaceChatContext(input);
  const provider = createOpenAI({
    apiKey: getRequiredOpenAiApiKey(),
  });
  const contextBlock = buildContextBlock(assistantMetadata.citations);

  const result = streamText({
    abortSignal: input.signal,
    maxOutputTokens: getWorkspaceChatMaxOutputTokens(),
    model: provider(getWorkspaceChatModel()),
    messages: await convertToModelMessages(historyMessages),
    system: [
      `You are the workspace assistant for "${workspace.name}".`,
      "Answer only from the retrieved workspace documents and completed deep research reports from this same session.",
      "Do not use web knowledge, hidden prior knowledge, or unsupported assumptions.",
      "Keep answers concise, document-grounded, and useful. Prefer short paragraphs or bullets when that improves clarity.",
      "If the available workspace material does not support a confident answer, say so plainly.",
      "Do not include inline citation markers like [1]; source cards are rendered separately in the UI.",
      "",
      "Retrieved context:",
      contextBlock,
    ].join("\n"),
  });

  return {
    assistantMetadata,
    result,
    userText,
    workspace,
  };
}

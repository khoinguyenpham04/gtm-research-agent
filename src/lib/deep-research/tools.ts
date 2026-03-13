import { HumanMessage } from "@langchain/core/messages";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { tool } from "langchain";
import OpenAI from "openai";
import { z } from "zod";

import { listDocumentChunksByIds } from "@/lib/documents";
import {
  summarizeWebpagePrompt,
} from "@/lib/deep-research/prompts";
import { inferSourceTierFromUrl } from "@/lib/deep-research/source-tier";
import type {
  DocumentSearchArtifact,
  DeepResearchModelConfig,
  SearchToolEnvelope,
  SearchMatch,
  SummaryResult,
  TavilySearchArtifact,
} from "@/lib/deep-research/types";
import {
  searchToolEnvelopeSchema,
} from "@/lib/deep-research/types";
import type {
  DeepResearchModelFactory,
} from "@/lib/deep-research/openai-model-factory";
import { createSupabaseClients } from "@/lib/supabase";

const thinkToolSchema = z.object({
  reflection: z.string().min(1),
});

const conductResearchSchema = z.object({
  researchTopic: z
    .string()
    .min(1)
    .describe(
      "The focused topic to research. Be specific and include all relevant constraints.",
    ),
});

const searchSchema = z.object({
  queries: z.array(z.string().trim().min(1)).min(1),
  matchCount: z.number().int().min(1).max(10).optional(),
});

const researchCompleteSchema = z.object({});

interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  raw_content?: string;
}

interface TavilySearchResponse {
  query: string;
  results: TavilySearchResult[];
}

export interface TavilySearchOptions {
  searchDepth?: "basic" | "advanced";
  includeRawContent?: boolean;
  summarizeRawContent?: boolean;
}

export interface ResearchToolContext {
  runId: string;
  selectedDocumentIds: string[];
  openAiApiKey: string;
  tavilyApiKey?: string;
  modelConfig: DeepResearchModelConfig;
  models: DeepResearchModelFactory;
  logEvent?: (
    runId: string,
    stage: string,
    eventType: string,
    message: string,
    payload?: Record<string, unknown>,
  ) => Promise<void>;
}

const SEARCH_TOOL_ENVELOPE_START = "<<<DEEP_RESEARCH_SEARCH_TOOL_RESULT_START>>>";
const SEARCH_TOOL_ENVELOPE_END = "<<<DEEP_RESEARCH_SEARCH_TOOL_RESULT_END>>>";

export interface SearchableDocumentChunk {
  id: number;
  content: string;
  metadata: Record<string, unknown>;
  embedding?: unknown;
}

function getTodayString() {
  const date = new Date();
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getOpenAIClient(apiKey: string) {
  return new OpenAI({ apiKey });
}

function parseEmbedding(embedding: unknown): number[] | null {
  if (Array.isArray(embedding)) {
    const numbers = embedding
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    return numbers.length > 0 ? numbers : null;
  }

  if (typeof embedding === "string") {
    try {
      return parseEmbedding(JSON.parse(embedding));
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeExcerpt(content: string, maxLength = 420) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trim()}...`;
}

function normalizeSearchContent(
  content: string | undefined,
  rawContent: string | undefined,
  modelConfig: DeepResearchModelConfig,
) {
  const preferred = content?.trim() || rawContent?.trim() || "";
  return normalizeExcerpt(
    preferred,
    Math.min(modelConfig.maxContentLength, 1400),
  );
}

async function withTimeout<T>(
  operation: Promise<T>,
  ms: number,
  label: string,
) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${ms}ms.`));
        }, ms);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function encodeSearchToolEnvelope(envelope: SearchToolEnvelope) {
  return `${envelope.renderedText}\n\n${SEARCH_TOOL_ENVELOPE_START}\n${JSON.stringify(envelope)}\n${SEARCH_TOOL_ENVELOPE_END}`;
}

export function parseSearchToolEnvelope(raw: string): SearchToolEnvelope | null {
  const startIndex = raw.lastIndexOf(SEARCH_TOOL_ENVELOPE_START);
  const endIndex = raw.lastIndexOf(SEARCH_TOOL_ENVELOPE_END);
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return null;
  }

  const payload = raw
    .slice(startIndex + SEARCH_TOOL_ENVELOPE_START.length, endIndex)
    .trim();
  try {
    return searchToolEnvelopeSchema.parse(JSON.parse(payload));
  } catch {
    return null;
  }
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export function formatDocumentSearchResults(matches: SearchMatch[]) {
  if (matches.length === 0) {
    return "No matching evidence was found in the selected uploaded documents.";
  }

  const lines = ["Document search results:"];
  matches.forEach((match, index) => {
    const fileName =
      typeof match.metadata.file_name === "string"
        ? match.metadata.file_name
        : "Unknown document";
    const documentId =
      typeof match.metadata.document_id === "string"
        ? match.metadata.document_id
        : "unknown";
    const chunkIndex =
      typeof match.metadata.chunk_index === "number"
        ? match.metadata.chunk_index
        : Number(match.metadata.chunk_index ?? 0);
    const totalChunks =
      typeof match.metadata.total_chunks === "number"
        ? match.metadata.total_chunks
        : Number(match.metadata.total_chunks ?? 0);
    const fileUrl =
      typeof match.metadata.document_id === "string"
        ? `/api/documents?id=${match.metadata.document_id}&file=true${
            typeof match.metadata.file_type === "string" &&
            match.metadata.file_type === "application/pdf"
              ? "&view=true"
              : typeof match.metadata.file_name === "string" &&
                  match.metadata.file_name.toLowerCase().endsWith(".pdf")
                ? "&view=true"
                : ""
          }`
        : undefined;

    lines.push("");
    lines.push(`--- SOURCE ${index + 1}: ${fileName} ---`);
    lines.push(`Document ID: ${documentId}`);
    lines.push(`Chunk: ${chunkIndex + 1}${totalChunks ? `/${totalChunks}` : ""}`);
    if (fileUrl) {
      lines.push(`URL: ${fileUrl}`);
    }
    lines.push(`Similarity: ${match.similarity.toFixed(4)}`);
    lines.push("");
    lines.push(match.content);
  });

  return lines.join("\n");
}

function formatTavilyResults(results: Map<string, { title: string; content: string }>) {
  if (results.size === 0) {
    return "No relevant Tavily search results were found.";
  }

  const lines = ["Search results:"];
  Array.from(results.entries()).forEach(([url, result], index) => {
    lines.push("");
    lines.push(`--- SOURCE ${index + 1}: ${result.title} ---`);
    lines.push(`URL: ${url}`);
    lines.push("");
    lines.push(result.content);
  });

  return lines.join("\n");
}

export async function searchSelectedDocuments(
  openAiApiKey: string,
  selectedDocumentIds: string[],
  queries: string[],
  matchCount = 5,
): Promise<SearchMatch[]> {
  if (selectedDocumentIds.length === 0) {
    return [];
  }

  const openai = getOpenAIClient(openAiApiKey);
  const { supabaseAdmin } = createSupabaseClients();
  const queryEmbeddings = await Promise.all(
    queries.map(async (query) => {
      const response = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: query,
      });

      return response.data[0]?.embedding ?? [];
    }),
  );

  const rankedMatches = new Map<string, SearchMatch>();

  for (const embedding of queryEmbeddings) {
    const rpcResult = await supabaseAdmin.rpc("match_documents", {
      query_embedding: embedding,
      match_threshold: 0,
      match_count: matchCount,
      selected_document_ids: selectedDocumentIds,
    });

    if (!rpcResult.error && Array.isArray(rpcResult.data)) {
      for (const row of rpcResult.data as SearchMatch[]) {
        const metadata = (row.metadata ?? {}) as Record<string, unknown>;
        const key = `${metadata.document_id ?? "unknown"}:${metadata.chunk_index ?? row.id}`;
        const existing = rankedMatches.get(key);
        if (!existing || row.similarity > existing.similarity) {
          rankedMatches.set(key, {
            id: Number(row.id),
            content: row.content,
            metadata,
            similarity: Number(row.similarity ?? 0),
          });
        }
      }
      continue;
    }

    const chunks = await listDocumentChunksByIds(selectedDocumentIds);
    const fallbackMatches = filterAndRankDocumentChunks(
      chunks,
      selectedDocumentIds,
      embedding,
      matchCount,
    );

    for (const match of fallbackMatches) {
      const key = `${match.metadata.document_id ?? "unknown"}:${match.metadata.chunk_index ?? match.id}`;
      const existing = rankedMatches.get(key);
      if (!existing || match.similarity > existing.similarity) {
        rankedMatches.set(key, match);
      }
    }
  }

  return Array.from(rankedMatches.values())
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, Math.max(matchCount, 5));
}

export function filterAndRankDocumentChunks(
  chunks: SearchableDocumentChunk[],
  selectedDocumentIds: string[],
  queryEmbedding: number[],
  matchCount: number,
) {
  return chunks
    .filter((chunk) => {
      const documentId = chunk.metadata.document_id;
      return (
        typeof documentId === "string" &&
        selectedDocumentIds.includes(documentId)
      );
    })
    .map((chunk) => {
      const chunkEmbedding = parseEmbedding(chunk.embedding);
      if (!chunkEmbedding) {
        return null;
      }

      return {
        id: chunk.id,
        content: chunk.content,
        metadata: chunk.metadata,
        similarity: cosineSimilarity(chunkEmbedding, queryEmbedding),
      };
    })
    .filter((match): match is SearchMatch => match !== null)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, matchCount);
}

async function summarizeWebpage(
  models: DeepResearchModelFactory,
  modelConfig: DeepResearchModelConfig,
  rawContent: string,
  fallbackContent?: string,
) {
  try {
    const result = await withTimeout(
      models.invokeStructured<SummaryResult>(
        "summarization",
        z.object({
          summary: z.string(),
          keyExcerpts: z.string(),
        }),
        [
          new HumanMessage({
            content: summarizeWebpagePrompt
              .replace("{date}", getTodayString())
              .replace(
                "{webpageContent}",
                rawContent.slice(0, modelConfig.maxContentLength),
              ),
          }),
        ],
      ),
      60_000,
      "Tavily page summarization",
    );

    return `<summary>\n${result.summary}\n</summary>\n\n<key_excerpts>\n${result.keyExcerpts}\n</key_excerpts>`;
  } catch {
    return normalizeSearchContent(fallbackContent, rawContent, modelConfig);
  }
}

async function callTavily(
  tavilyApiKey: string,
  query: string,
  maxResults: number,
  options: TavilySearchOptions = {},
): Promise<TavilySearchResponse> {
  const searchDepth = options.searchDepth ?? "advanced";
  const includeRawContent = options.includeRawContent ?? true;
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: tavilyApiKey,
      query,
      max_results: maxResults,
      topic: "general",
      search_depth: searchDepth,
      include_raw_content: includeRawContent,
      include_answer: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Tavily search failed with status ${response.status}${
        errorText ? `: ${errorText}` : "."
      }`,
    );
  }

  const payload = (await response.json()) as TavilySearchResponse;
  return {
    query,
    results: payload.results ?? [],
  };
}

async function searchTavily(
  context: ResearchToolContext,
  queries: string[],
  matchCount = 5,
  options: TavilySearchOptions = {},
) {
  if (!context.tavilyApiKey) {
    return {
      renderedText:
        "Tavily search is unavailable because TAVILY_API_KEY is not configured.",
      results: [] satisfies TavilySearchArtifact["results"],
    };
  }

  const searchResponses = await Promise.allSettled(
    queries.map((query) =>
      callTavily(context.tavilyApiKey as string, query, matchCount, options),
    ),
  );
  const successfulResponses = searchResponses
    .filter(
      (
        result,
      ): result is PromiseFulfilledResult<TavilySearchResponse> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value);

  if (successfulResponses.length === 0) {
    const failureReasons = searchResponses
      .filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      )
      .map((result) =>
        result.reason instanceof Error ? result.reason.message : String(result.reason),
      );
    throw new Error(
      failureReasons.length > 0
        ? failureReasons.join(" | ")
        : "All Tavily searches failed.",
    );
  }

  const uniqueResults = new Map<
    string,
    {
      title: string;
      content: string;
      sourceTier: TavilySearchArtifact["results"][number]["sourceTier"];
      rawContent?: string;
    }
  >();
  for (const response of successfulResponses) {
    for (const result of response.results) {
      if (!result.url || uniqueResults.has(result.url)) {
        continue;
      }

      uniqueResults.set(result.url, {
        title: result.title,
        content: normalizeSearchContent(
          result.content,
          result.raw_content,
          context.modelConfig,
        ),
        sourceTier: inferSourceTierFromUrl(result.url, result.title),
        rawContent: result.raw_content,
      });
    }
  }

  const shouldSummarizeRawContent =
    (options.includeRawContent ?? true) &&
    (options.summarizeRawContent ?? true);

  if (shouldSummarizeRawContent) {
    const entries = Array.from(uniqueResults.entries());
    const summaries = await Promise.allSettled(
      entries.map(([, result]) =>
        result.rawContent
          ? summarizeWebpage(
              context.models,
              context.modelConfig,
              result.rawContent,
              result.content,
            )
          : Promise.resolve(result.content),
      ),
    );

    entries.forEach(([url, result], index) => {
      const summary = summaries[index];
      uniqueResults.set(url, {
        title: result.title,
        content:
          summary?.status === "fulfilled" ? summary.value : result.content,
        sourceTier: result.sourceTier,
        rawContent: result.rawContent,
      });
    });
  }

  return {
    renderedText: formatTavilyResults(
      new Map(
        Array.from(uniqueResults.entries()).map(([url, result]) => [
          url,
          { title: result.title, content: result.content },
        ]),
      ),
    ),
    results: Array.from(uniqueResults.entries()).map(([url, result]) => ({
      title: result.title,
      url,
      excerpt: normalizeExcerpt(result.content),
      sourceTier: result.sourceTier,
    })),
  };
}

export async function runTavilySearch(
  context: ResearchToolContext,
  queries: string[],
  matchCount = 5,
  options: TavilySearchOptions = {},
) {
  await context.logEvent?.(
    context.runId,
    "searching",
    "web_search_started",
    "Running Tavily web searches.",
    { queries, options },
  );

  try {
    const result = await searchTavily(context, queries, matchCount, options);

    await context.logEvent?.(
      context.runId,
      "searching",
      "web_search_completed",
      "Completed Tavily web search.",
      { queries, resultCount: result.results.length, options },
    );

    return encodeSearchToolEnvelope({
      toolName: "tavilySearch",
      renderedText: result.renderedText,
      artifact: {
        queries,
        results: result.results,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await context.logEvent?.(
      context.runId,
      "searching",
      "web_search_failed",
      "Tavily web search failed.",
      { queries, error: message, options },
    );

    throw error;
  }
}

export function createSupervisorTools() {
  const think = tool(
    async ({ reflection }) => `Reflection recorded: ${reflection}`,
    {
      name: "thinkTool",
      description: "Strategic reflection tool for planning and progress checks.",
      schema: thinkToolSchema,
    },
  );

  const conductResearch = tool(
    async ({ researchTopic }) =>
      `Delegating research on: ${researchTopic.slice(0, 160)}`,
    {
      name: "ConductResearch",
      description: "Delegate research to a sub-agent on a focused topic.",
      schema: conductResearchSchema,
    },
  );

  const researchComplete = tool(
    async () => "Research complete.",
    {
      name: "ResearchComplete",
      description: "Signal that the current research phase is complete.",
      schema: researchCompleteSchema,
    },
  );

  return { think, conductResearch, researchComplete };
}

export function createResearcherTools(context: ResearchToolContext) {
  const think = tool(
    async ({ reflection }) => {
      await context.logEvent?.(
        context.runId,
        "researching",
        "reflection_recorded",
        "Researcher reflection recorded.",
        { reflection },
      );
      return `Reflection recorded: ${reflection}`;
    },
    {
      name: "thinkTool",
      description: "Strategic reflection tool for planning and progress checks.",
      schema: thinkToolSchema,
    },
  );

  const selectedDocumentsSearch = tool(
    async ({ queries, matchCount }) => {
      await context.logEvent?.(
        context.runId,
        "retrieving",
        "document_search_started",
        "Searching selected uploaded documents.",
        { queries, selectedDocumentIds: context.selectedDocumentIds },
      );

      const matches = await searchSelectedDocuments(
        context.openAiApiKey,
        context.selectedDocumentIds,
        queries,
        matchCount ?? 5,
      );
      const matchedDocumentIds = new Set(
        matches
          .map((match) => match.metadata.document_id)
          .filter((documentId): documentId is string => typeof documentId === "string"),
      );

      await context.logEvent?.(
        context.runId,
        "retrieving",
        "document_search_completed",
        `Retrieved ${matches.length} evidence matches across ${matchedDocumentIds.size} selected documents.`,
        {
          queries,
          matchCount: matches.length,
          matchedDocumentCount: matchedDocumentIds.size,
        },
      );

      const renderedText = formatDocumentSearchResults(matches);
      const artifact: DocumentSearchArtifact = {
        queries,
        matches: matches.map((match) => ({
          id: Number(match.id),
          excerpt: normalizeExcerpt(match.content),
          similarity: Number(match.similarity ?? 0),
          documentId:
            typeof match.metadata.document_id === "string"
              ? match.metadata.document_id
              : undefined,
          chunkIndex:
            typeof match.metadata.chunk_index === "number"
              ? match.metadata.chunk_index
              : Number.isFinite(Number(match.metadata.chunk_index))
                ? Number(match.metadata.chunk_index)
                : undefined,
          fileName:
            typeof match.metadata.file_name === "string"
              ? match.metadata.file_name
              : undefined,
          fileUrl:
            typeof match.metadata.document_id === "string"
              ? `/api/documents?id=${match.metadata.document_id}&file=true${
                  typeof match.metadata.file_type === "string" &&
                  match.metadata.file_type === "application/pdf"
                    ? "&view=true"
                    : typeof match.metadata.file_name === "string" &&
                        match.metadata.file_name.toLowerCase().endsWith(".pdf")
                      ? "&view=true"
                      : ""
                }`
              : undefined,
        })),
      };

      return encodeSearchToolEnvelope({
        toolName: "selectedDocumentsSearch",
        renderedText,
        artifact,
      });
    },
    {
      name: "selectedDocumentsSearch",
      description:
        "Search only inside the selected uploaded documents to gather grounded evidence.",
      schema: searchSchema,
    },
  );

  const tavilySearch = tool(
    async ({ queries, matchCount }) => {
      return runTavilySearch(context, queries, matchCount ?? 5);
    },
    {
      name: "tavilySearch",
      description:
        "Search the web with Tavily to gather or validate external evidence.",
      schema: searchSchema,
    },
  );

  const researchComplete = tool(
    async () => "Research complete.",
    {
      name: "ResearchComplete",
      description: "Signal that the current research task is complete.",
      schema: researchCompleteSchema,
    },
  );

  const tools = [
    selectedDocumentsSearch,
    tavilySearch,
    researchComplete,
    think,
  ] satisfies DynamicStructuredTool[];

  const toolsByName = new Map<string, DynamicStructuredTool>(
    tools.map((item) => [item.name, item]),
  );

  return {
    tools,
    toolsByName,
  };
}

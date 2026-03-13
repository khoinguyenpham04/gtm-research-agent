import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";

import {
  getRequiredOpenAiApiKey,
  getWorkspaceChatMaxOutputTokens,
  getWorkspaceChatModel,
} from "@/lib/deep-research/config";
import type {
  WorkspaceChatCitation,
  WorkspaceChatMessageMetadata,
} from "@/lib/deep-research/types";
import {
  buildWorkspaceChatContextBlock,
  prepareWorkspaceChatTurn,
  type WorkspaceChatHistoryTurn,
} from "@/lib/deep-research/workspace-chat";

type AskWorkspaceStatus =
  | "starting"
  | "retrieving"
  | "streaming";

type AskWorkspaceEmitter = {
  onAssistantDelta?: (delta: string) => void | Promise<void>;
  onReasoning?: (metadata: WorkspaceChatMessageMetadata) => void | Promise<void>;
  onSources?: (sources: WorkspaceChatCitation[]) => void | Promise<void>;
  onStatus?: (status: AskWorkspaceStatus) => void | Promise<void>;
};

type AskWorkspaceGraphResult = {
  assistantMetadata: WorkspaceChatMessageMetadata;
  assistantText: string;
  userMessageId: string;
  userText: string;
};

const askWorkspaceState = Annotation.Root({
  assistantMetadata: Annotation<WorkspaceChatMessageMetadata | null>({
    default: () => null,
    reducer: (_current, update) => update,
  }),
  assistantText: Annotation<string>({
    default: () => "",
    reducer: (_current, update) => update,
  }),
  historyTurns: Annotation<WorkspaceChatHistoryTurn[]>({
    default: () => [],
    reducer: (_current, update) => update,
  }),
  selectedDocumentIds: Annotation<string[]>({
    default: () => [],
    reducer: (_current, update) => update,
  }),
  sessionId: Annotation<string>({
    default: () => "",
    reducer: (_current, update) => update,
  }),
  userMessageId: Annotation<string>({
    default: () => "",
    reducer: (_current, update) => update,
  }),
  userText: Annotation<string>({
    default: () => "",
    reducer: (_current, update) => update,
  }),
  workspaceName: Annotation<string>({
    default: () => "",
    reducer: (_current, update) => update,
  }),
});

function toLangChainMessages(turns: WorkspaceChatHistoryTurn[]) {
  return turns.reduce<BaseMessage[]>((messages, turn) => {
    if (!turn.content.trim()) {
      return messages;
    }

    if (turn.role === "assistant") {
      messages.push(new AIMessage(turn.content));
      return messages;
    }

    messages.push(new HumanMessage(turn.content));
    return messages;
  }, []);
}

function extractChunkText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (
        typeof part === "object" &&
        part !== null &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return part.text;
      }

      return "";
    })
    .join("");
}

function buildWorkspaceSystemPrompt(args: {
  contextBlock: string;
  workspaceName: string;
}) {
  return [
    `You are the workspace assistant for "${args.workspaceName}".`,
    "Answer only from the retrieved workspace knowledge attached to this workspace.",
    "Do not use web knowledge, hidden prior knowledge, or unsupported assumptions.",
    "Keep answers concise, document-grounded, and useful. Prefer short paragraphs or bullets when that improves clarity.",
    "If the available workspace material does not support a confident answer, say so plainly.",
    "Do not include inline citation markers like [1]; source cards are rendered separately in the UI.",
    "",
    "Retrieved context:",
    args.contextBlock,
  ].join("\n");
}

export async function runAskWorkspaceGraph(input: {
  clerkUserId: string;
  selectedDocumentIds: string[];
  sessionId: string;
  signal?: AbortSignal;
  text: string;
  userMessageId?: string;
  emitter?: AskWorkspaceEmitter;
}): Promise<AskWorkspaceGraphResult> {
  const apiKey = getRequiredOpenAiApiKey();
  const model = new ChatOpenAI({
    apiKey,
    model: getWorkspaceChatModel(),
    temperature: 0,
    maxTokens: getWorkspaceChatMaxOutputTokens(),
    maxRetries: 1,
  });

  const graph = new StateGraph(askWorkspaceState)
    .addNode("validate_scope", async (state) => {
      await input.emitter?.onStatus?.("starting");
      return {
        selectedDocumentIds: state.selectedDocumentIds,
        sessionId: state.sessionId,
        userText: state.userText.trim(),
      };
    })
    .addNode("retrieve_workspace_knowledge", async (state) => {
      await input.emitter?.onStatus?.("retrieving");
      const prepared = await prepareWorkspaceChatTurn({
        clerkUserId: input.clerkUserId,
        selectedDocumentIds: state.selectedDocumentIds,
        sessionId: state.sessionId,
        text: state.userText,
        userMessageId: input.userMessageId,
      });

      await input.emitter?.onReasoning?.(prepared.assistantMetadata);
      await input.emitter?.onSources?.(prepared.assistantMetadata.sources);

      return {
        assistantMetadata: prepared.assistantMetadata,
        historyTurns: prepared.historyTurns,
        userMessageId: prepared.userMessageId,
        userText: prepared.userText,
        workspaceName: prepared.workspace.name,
      };
    })
    .addNode("generate_answer", async (state) => {
      if (!state.assistantMetadata) {
        throw new Error("Workspace retrieval metadata is missing.");
      }

      await input.emitter?.onStatus?.("streaming");
      const contextBlock = buildWorkspaceChatContextBlock(
        state.assistantMetadata.sources,
      );
      const messages = [
        new SystemMessage(
          buildWorkspaceSystemPrompt({
            contextBlock,
            workspaceName: state.workspaceName,
          }),
        ),
        ...toLangChainMessages(state.historyTurns),
      ];

      let assistantText = "";
      const stream = await model.stream(messages, {
        signal: input.signal,
      });

      for await (const chunk of stream) {
        if (input.signal?.aborted) {
          throw new DOMException("Ask Workspace request aborted.", "AbortError");
        }

        const delta = extractChunkText(chunk.content);
        if (!delta) {
          continue;
        }

        assistantText += delta;
        await input.emitter?.onAssistantDelta?.(delta);
      }

      return {
        assistantText: assistantText.trim(),
      };
    })
    .addNode("finalize_response", async (state) => {
      if (!state.assistantMetadata) {
        throw new Error("Workspace chat metadata is missing.");
      }

      return {
        assistantMetadata: {
          ...state.assistantMetadata,
          model: getWorkspaceChatModel(),
        },
      };
    })
    .addEdge(START, "validate_scope")
    .addEdge("validate_scope", "retrieve_workspace_knowledge")
    .addEdge("retrieve_workspace_knowledge", "generate_answer")
    .addEdge("generate_answer", "finalize_response")
    .addEdge("finalize_response", END)
    .compile();

  const result = await graph.invoke(
    {
      selectedDocumentIds: input.selectedDocumentIds,
      sessionId: input.sessionId,
      userText: input.text,
    },
    {
      configurable: {
        thread_id: `ask-workspace:${input.sessionId}:${input.userMessageId ?? crypto.randomUUID()}`,
      },
    },
  );

  if (!result.assistantMetadata) {
    throw new Error("Workspace chat metadata is missing.");
  }

  if (!result.assistantText.trim()) {
    throw new Error("Workspace chat did not generate a response.");
  }

  return {
    assistantMetadata: result.assistantMetadata,
    assistantText: result.assistantText.trim(),
    userMessageId: result.userMessageId,
    userText: result.userText.trim(),
  };
}

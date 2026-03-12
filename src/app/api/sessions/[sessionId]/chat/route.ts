import { consumeStream, type UIMessage } from "ai";
import { NextResponse } from "next/server";

import { ensureDeepResearchDatabase } from "@/lib/deep-research/db";
import { appendSessionMessage } from "@/lib/deep-research/repository";
import type {
  WorkspaceChatMessageMetadata,
  WorkspaceChatUIMessage,
} from "@/lib/deep-research/types";
import { streamWorkspaceChat } from "@/lib/deep-research/workspace-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function extractMessageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    await ensureDeepResearchDatabase();

    const { sessionId } = await context.params;
    const body = (await request.json()) as {
      messages?: WorkspaceChatUIMessage[];
      selectedDocumentIds?: string[];
    };

    const requestMessages = Array.isArray(body.messages) ? body.messages : [];
    if (requestMessages.length === 0) {
      return NextResponse.json(
        { error: "Chat messages are required." },
        { status: 400 },
      );
    }

    const { assistantMetadata, result } = await streamWorkspaceChat({
      requestMessages,
      selectedDocumentIds: Array.isArray(body.selectedDocumentIds)
        ? body.selectedDocumentIds
        : [],
      sessionId,
      signal: request.signal,
    });

    return result.toUIMessageStreamResponse<WorkspaceChatUIMessage>({
      consumeSseStream: consumeStream,
      generateMessageId: () => crypto.randomUUID(),
      messageMetadata: ({ part }) => {
        if (part.type === "start") {
          return assistantMetadata;
        }

        if (part.type === "finish") {
          return {
            ...assistantMetadata,
            finishedAt: new Date().toISOString(),
          } satisfies WorkspaceChatMessageMetadata;
        }

        return undefined;
      },
      onError: (error) =>
        error instanceof Error
          ? error.message
          : "Workspace chat failed to generate a response.",
      onFinish: async ({ finishReason, isAborted, responseMessage }) => {
        if (isAborted || finishReason === "error") {
          return;
        }

        const contentMarkdown = extractMessageText(responseMessage);
        if (!contentMarkdown) {
          return;
        }

        await appendSessionMessage({
          id: responseMessage.id,
          sessionId,
          role: "assistant",
          messageType: "chat",
          contentMarkdown,
          metadata: {
            ...assistantMetadata,
            finishedAt: new Date().toISOString(),
          },
        });
      },
      originalMessages: requestMessages,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to generate a workspace chat response.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { runAskWorkspaceGraph } from "@/lib/deep-research/ask-workspace-graph";
import { ensureDeepResearchDatabase } from "@/lib/deep-research/db";
import { appendSessionMessage } from "@/lib/deep-research/repository";
import { getSession, updateSessionTitle } from "@/lib/deep-research/service";
import {
  buildSessionTitleFromPrompt,
  isProvisionalSessionTitle,
} from "@/lib/deep-research/session-title";
import type {
  WorkspaceChatCitation,
  WorkspaceChatMessageMetadata,
  WorkspaceChatTraceEvent,
} from "@/lib/deep-research/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const workspaceChatRequestSchema = z.object({
  text: z.string().trim().min(1, "A chat message is required."),
  selectedDocumentIds: z.array(z.string().trim().min(1)).default([]),
});

function createTraceEvent(
  stage: WorkspaceChatTraceEvent["stage"],
  message: string,
  details?: Record<string, unknown>,
): WorkspaceChatTraceEvent {
  return {
    createdAt: new Date().toISOString(),
    details: details ?? {},
    id: crypto.randomUUID(),
    message,
    stage,
  };
}

function getTraceMessage(stage: WorkspaceChatTraceEvent["stage"]) {
  switch (stage) {
    case "starting":
      return "Ask Workspace request started."
    case "retrieving":
      return "Retrieving workspace knowledge."
    case "streaming":
      return "Generating grounded answer."
    case "completed":
      return "Ask Workspace answer completed."
    case "error":
      return "Ask Workspace request failed."
    default:
      return "Ask Workspace step."
  }
}

function createSseStream(init: {
  request: Request;
  run: (helpers: {
    close: () => void;
    sendEvent: (event: string, data: Record<string, unknown>) => void;
  }) => Promise<void>;
}) {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        controller.close();
      };

      const sendEvent = (event: string, data: Record<string, unknown>) => {
        if (closed) {
          return;
        }

        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };

      const abortHandler = () => {
        close();
      };

      init.request.signal.addEventListener("abort", abortHandler);

      try {
        await init.run({
          close,
          sendEvent,
        });
      } catch (error) {
        if (!init.request.signal.aborted) {
          const message =
            error instanceof Error
              ? error.message
              : "Workspace chat failed to generate a response.";
          sendEvent("trace", {
            traceEvent: createTraceEvent("error", message),
          });
          sendEvent("error", {
            message,
          });
        }
      } finally {
        init.request.signal.removeEventListener("abort", abortHandler);
        close();
      }
    },
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let sessionId = "";
  let payload:
    | {
        selectedDocumentIds: string[];
        text: string;
      }
    | undefined;

  try {
    await ensureDeepResearchDatabase();
    ({ sessionId } = await context.params);
    payload = workspaceChatRequestSchema.parse(await request.json());
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues[0]?.message ?? "Invalid Ask Workspace request."
        : error instanceof Error
          ? error.message
          : "Failed to start Ask Workspace.";

    return NextResponse.json({ error: message }, { status: 400 });
  }

  const stream = createSseStream({
    request,
    run: async ({ sendEvent }) => {
      const userMessageId = crypto.randomUUID();
      const assistantMessageId = crypto.randomUUID();
      let latestMetadata: WorkspaceChatMessageMetadata | null = null;
      let latestSources: WorkspaceChatCitation[] = [];
      let latestAssistantText = "";
      const traceEvents: WorkspaceChatTraceEvent[] = [];

      const pushTraceEvent = (
        stage: WorkspaceChatTraceEvent["stage"],
        details?: Record<string, unknown>,
        message = getTraceMessage(stage),
      ) => {
        const traceEvent = createTraceEvent(stage, message, details);
        traceEvents.push(traceEvent);
        sendEvent("trace", {
          requestId: assistantMessageId,
          traceEvent,
        });
      };

      sendEvent("status", {
        phase: "starting",
        requestId: assistantMessageId,
      });
      pushTraceEvent("starting");

      const result = await runAskWorkspaceGraph({
        clerkUserId: userId,
        emitter: {
          onAssistantDelta: async (delta) => {
            latestAssistantText += delta;
            sendEvent("assistant_delta", {
              delta,
              requestId: assistantMessageId,
            });
          },
          onReasoning: async (metadata) => {
            latestMetadata = {
              ...metadata,
              traceEvents,
            };
            sendEvent("reasoning", {
              metadata: latestMetadata,
              requestId: assistantMessageId,
            });
            const retrievalMessage =
              metadata.retrievalScopeLabel || getTraceMessage("retrieving");
            const existingRetrievalTrace = traceEvents.find(
              (traceEvent) => traceEvent.stage === "retrieving",
            );

            if (existingRetrievalTrace) {
              existingRetrievalTrace.details = {
                ...existingRetrievalTrace.details,
                retrievedGeneratedReportCount:
                  metadata.retrievedGeneratedReportCount,
                retrievedUploadedDocumentCount:
                  metadata.retrievedUploadedDocumentCount,
                retrievalScopeLabel: metadata.retrievalScopeLabel,
                sourceCount: metadata.sourceCount,
              };
              existingRetrievalTrace.message = retrievalMessage;
            } else {
              pushTraceEvent(
                "retrieving",
                {
                  retrievedGeneratedReportCount:
                    metadata.retrievedGeneratedReportCount,
                  retrievedUploadedDocumentCount:
                    metadata.retrievedUploadedDocumentCount,
                  retrievalScopeLabel: metadata.retrievalScopeLabel,
                  sourceCount: metadata.sourceCount,
                },
                retrievalMessage,
              );
            }
          },
          onSources: async (sources) => {
            latestSources = sources;
            sendEvent("sources", {
              requestId: assistantMessageId,
              sources,
            });
          },
          onStatus: async (phase) => {
            sendEvent("status", {
              phase,
              requestId: assistantMessageId,
            });

            if (phase === "starting") {
              return;
            }

            if (
              phase === "retrieving" &&
              !traceEvents.some((traceEvent) => traceEvent.stage === "retrieving")
            ) {
              pushTraceEvent("retrieving");
              return;
            }

            if (
              phase === "streaming" &&
              !traceEvents.some((traceEvent) => traceEvent.stage === "streaming")
            ) {
              pushTraceEvent("streaming");
            }
          },
        },
        selectedDocumentIds: payload?.selectedDocumentIds ?? [],
        sessionId,
        signal: request.signal,
        text: payload?.text ?? "",
        userMessageId,
      });

      if (request.signal.aborted) {
        return;
      }

      pushTraceEvent("completed", {
        sourceCount: latestSources.length,
      });

      const assistantMetadata = {
        ...(latestMetadata ?? result.assistantMetadata),
        citations: latestSources.length > 0 ? latestSources : result.assistantMetadata.citations,
        sources: latestSources.length > 0 ? latestSources : result.assistantMetadata.sources,
        traceEvents,
        finishedAt: new Date().toISOString(),
      } satisfies WorkspaceChatMessageMetadata;

      await appendSessionMessage({
        clerkUserId: userId,
        contentMarkdown: latestAssistantText.trim() || result.assistantText,
        id: assistantMessageId,
        messageType: "chat",
        metadata: assistantMetadata,
        role: "assistant",
        sessionId,
      });

      try {
        const currentSession = await getSession(sessionId, userId);
        if (currentSession && isProvisionalSessionTitle(currentSession.title)) {
          await updateSessionTitle(
            sessionId,
            buildSessionTitleFromPrompt(result.userText),
            userId,
          );
        }
      } catch {
        // Best effort. Title updates should not fail the stream.
      }

      sendEvent("done", {
        assistantMessageId,
        requestId: assistantMessageId,
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

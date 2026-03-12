"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { startTransition, useEffect, useMemo, useRef, useState } from "react"
import { ArrowUpRightIcon, TelescopeIcon } from "lucide-react"
import { useStickToBottomContext } from "use-stick-to-bottom"

import {
  DeepResearchActivityDrawer,
  DeepResearchArtifactsPanel,
  DeepResearchClarificationCard,
  DeepResearchFailureCard,
  DeepResearchFinalReport,
  DeepResearchLaunchStatusCard,
} from "@/components/deep-research/thread-ui"
import {
  buildSessionThreadHref,
  extractActiveRateLimitRetry,
  extractPreResearchPlan,
  extractSourcesFromReport,
} from "@/components/deep-research/utils"
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message"
import { useSessionThread } from "@/components/sessions/use-session-thread"
import { SessionThreadComposer } from "@/components/sessions/session-thread-composer"
import { useSessionWorkspaceChat } from "@/components/sessions/use-session-workspace-chat"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type {
  SessionComposerMode,
  SessionMessage,
  SessionThreadResponse,
  WorkspaceChatCitation,
  WorkspaceChatUIMessage,
} from "@/lib/deep-research/types"
import {
  isWorkspaceChatMessageMetadata,
} from "@/lib/deep-research/types"
import type {
  WorkspaceDetail,
  WorkspaceSummary,
} from "@/lib/workspaces"

const CHAT_MESSAGE_CARD_CLASS = "border border-zinc-200 bg-white ring-0 shadow-none"
const USER_BUBBLE_CARD_CLASS =
  "ml-auto overflow-hidden rounded-[2rem] border border-zinc-200/80 bg-zinc-100/95 shadow-none"
const CHAT_MARKDOWN_CLASS =
  "size-full break-words text-[15px] leading-7 text-zinc-800 text-pretty [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_h1]:mt-2 [&_h1]:mb-5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h2]:mt-8 [&_h2]:mb-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-[-0.02em] [&_h3]:mt-6 [&_h3]:mb-3 [&_h3]:text-lg [&_h3]:font-semibold [&_p]:my-3 [&_p]:text-zinc-800 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1.5 [&_li]:pl-1 [&_li::marker]:text-zinc-400 [&_blockquote]:my-5 [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-200 [&_blockquote]:pl-4 [&_blockquote]:text-zinc-600 [&_hr]:my-6 [&_hr]:border-zinc-200 [&_pre]:my-5 [&_pre]:overflow-x-auto [&_pre]:rounded-2xl [&_pre]:border [&_pre]:border-zinc-200 [&_pre]:bg-zinc-950 [&_pre]:p-4 [&_pre]:text-[13px] [&_pre]:leading-6 [&_pre]:text-zinc-50 [&_code]:rounded-md [&_code]:bg-zinc-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.9em] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:text-primary/80 [&_table]:my-5 [&_table]:w-full [&_table]:border-collapse [&_table]:overflow-hidden [&_table]:rounded-xl [&_th]:border-b [&_th]:border-zinc-200 [&_th]:bg-zinc-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_td]:border-b [&_td]:border-zinc-100 [&_td]:px-3 [&_td]:py-2"

type ResearchPrefill = {
  text: string
  token: number
}

function extractUiMessageText(message: WorkspaceChatUIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim()
}

function isStreamingChatMessage(message: WorkspaceChatUIMessage) {
  return message.parts.some(
    (part) => part.type === "text" && part.state === "streaming",
  )
}

function buildEscalationPrompt(question: string) {
  return question.trim()
}

function WorkspaceChatSourceCard({
  citation,
  sessionId,
}: {
  citation: WorkspaceChatCitation
  sessionId: string
}) {
  const href =
    citation.sourceType === "workspace_document"
      ? citation.url
      : citation.runId
        ? buildSessionThreadHref({
            mode: "research",
            runId: citation.runId,
            sessionId,
          })
        : undefined

  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          className="rounded-full border-0 bg-zinc-900/6 text-[0.72rem] font-medium tracking-[0.02em] text-zinc-700 shadow-none"
          variant="secondary"
        >
          {citation.sourceType === "workspace_document"
            ? "Workspace doc"
            : "Research report"}
        </Badge>
        {citation.locationLabel ? (
          <span className="text-xs text-muted-foreground">{citation.locationLabel}</span>
        ) : null}
      </div>

      <div className="mt-2 space-y-2">
        <p className="text-sm font-medium text-foreground">{citation.title}</p>
        <p className="text-sm leading-6 text-muted-foreground">
          {citation.excerpt}
        </p>
      </div>

      {href ? (
        <div className="mt-3">
          <a
            className="inline-flex items-center gap-1 text-xs font-medium text-foreground transition-colors hover:text-primary"
            href={href}
            rel={
              citation.sourceType === "workspace_document" ? "noreferrer" : undefined
            }
            target={
              citation.sourceType === "workspace_document" ? "_blank" : undefined
            }
          >
            Open source
            <ArrowUpRightIcon className="size-3.5" />
          </a>
        </div>
      ) : null}
    </div>
  )
}

function AssistantChatMessage({
  citations,
  contentMarkdown,
  onEscalate,
  sessionId,
  streaming = false,
}: {
  contentMarkdown: string
  citations: WorkspaceChatCitation[]
  onEscalate?: () => void
  sessionId: string
  streaming?: boolean
}) {
  return (
    <Card className={CHAT_MESSAGE_CARD_CLASS}>
      <CardContent className="space-y-4 px-4 py-4">
        <div className="space-y-3">
          {streaming ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[0.7rem] font-medium uppercase tracking-[0.14em] text-zinc-500">
              <span className="inline-flex size-1.5 animate-pulse rounded-full bg-zinc-400" />
              Streaming
            </div>
          ) : null}

          <MessageResponse className={CHAT_MARKDOWN_CLASS}>
            {contentMarkdown}
          </MessageResponse>
        </div>

        {citations.length > 0 ? (
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Sources
            </p>
            <div className="grid gap-2">
              {citations.map((citation) => (
                <WorkspaceChatSourceCard
                  citation={citation}
                  key={citation.id}
                  sessionId={sessionId}
                />
              ))}
            </div>
          </div>
        ) : null}

        {onEscalate ? (
          <div className="pt-1">
            <Button
              className="rounded-full"
              onClick={onEscalate}
              size="sm"
              type="button"
              variant="outline"
            >
              <TelescopeIcon className="size-4" />
              Escalate to deep research
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function StreamingAssistantPlaceholder() {
  return (
    <Card className={CHAT_MESSAGE_CARD_CLASS}>
      <CardContent className="px-4 py-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[0.7rem] font-medium uppercase tracking-[0.14em] text-zinc-500">
          <span className="inline-flex size-1.5 animate-pulse rounded-full bg-zinc-400" />
          Streaming
        </div>
        <div className="mt-4 space-y-2">
          <div className="h-3 w-5/6 animate-pulse rounded-full bg-zinc-100" />
          <div className="h-3 w-4/6 animate-pulse rounded-full bg-zinc-100" />
          <div className="h-3 w-3/6 animate-pulse rounded-full bg-zinc-100" />
        </div>
      </CardContent>
    </Card>
  )
}

function UserChatBubble({
  contentMarkdown,
}: {
  contentMarkdown: string
}) {
  return (
    <Card className={USER_BUBBLE_CARD_CLASS}>
      <CardContent className="px-5 py-0">
        <p className="whitespace-pre-wrap text-left text-sm leading-7 text-foreground">
          {contentMarkdown}
        </p>
      </CardContent>
    </Card>
  )
}

function StreamingChatAutoScroll({
  scrollKey,
}: {
  scrollKey: string
}) {
  const { scrollToBottom, state } = useStickToBottomContext()
  const lastScrollKeyRef = useRef("")

  useEffect(() => {
    if (!scrollKey || scrollKey === lastScrollKeyRef.current) {
      return
    }

    lastScrollKeyRef.current = scrollKey

    if (!state.isAtBottom && !state.isNearBottom) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      void scrollToBottom({
        animation: "instant",
        ignoreEscapes: true,
      })
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [scrollKey, scrollToBottom, state.isAtBottom, state.isNearBottom])

  return null
}

function UserDeepResearchBubble({
  objective,
  selectedDocuments,
  topic,
}: {
  topic: string
  objective?: string
  selectedDocuments: Array<{ id: string; file_name: string }>
}) {
  return (
    <Card className={USER_BUBBLE_CARD_CLASS}>
      <CardContent className="space-y-4 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            className="rounded-full border-0 bg-[#EAF1FF] px-3 py-1 text-[#246BFF] shadow-none"
            variant="secondary"
          >
            <TelescopeIcon className="size-3.5" />
            Deep Research
          </Badge>
          <Badge className="rounded-full border-zinc-200 bg-transparent text-zinc-600 shadow-none" variant="outline">
            {selectedDocuments.length} doc{selectedDocuments.length === 1 ? "" : "s"}
          </Badge>
        </div>

        <p className="whitespace-pre-wrap text-left text-[1rem] leading-8 text-foreground">
          {topic}
        </p>

        {objective ? (
          <p className="whitespace-pre-wrap text-left text-sm leading-6 text-muted-foreground">
            {objective}
          </p>
        ) : null}

        {selectedDocuments.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {selectedDocuments.map((document) => (
              <span
                className="inline-flex max-w-full items-center rounded-full border border-zinc-200 bg-white/80 px-3 py-1 text-xs font-medium text-zinc-700"
                key={document.id}
              >
                <span className="truncate">{document.file_name}</span>
              </span>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function renderSessionMessageCard({
  message,
  onEscalate,
  sessionId,
}: {
  message: SessionMessage
  onEscalate?: () => void
  sessionId: string
}) {
  const linkedRun = message.linkedRun
  if (linkedRun) {
    return (
      <UserDeepResearchBubble
        objective={linkedRun.objective}
        selectedDocuments={linkedRun.selectedDocuments}
        topic={linkedRun.topic}
      />
    )
  }

  const chatMetadata = isWorkspaceChatMessageMetadata(message.metadata)
    ? message.metadata
    : null

  if (message.messageType === "chat" && message.role === "assistant") {
    return (
      <AssistantChatMessage
        citations={chatMetadata?.citations ?? []}
        contentMarkdown={message.contentMarkdown}
        onEscalate={onEscalate}
        sessionId={sessionId}
      />
    )
  }

  return (
    <UserChatBubble contentMarkdown={message.contentMarkdown} />
  )
}

function TransientChatMessage({
  message,
  sessionId,
}: {
  message: WorkspaceChatUIMessage
  sessionId: string
}) {
  const contentMarkdown = extractUiMessageText(message)
  if (message.role !== "assistant" && !contentMarkdown) {
    return null
  }

  const chatMetadata = isWorkspaceChatMessageMetadata(message.metadata)
    ? message.metadata
    : null

  return (
    <div className="space-y-5">
      <Message
        from={message.role}
        className={
          message.role === "assistant"
            ? "ml-0 max-w-full"
            : "max-w-[82%] sm:max-w-[76%]"
        }
      >
        <div className="w-full">
          {message.role === "assistant" && contentMarkdown ? (
            <AssistantChatMessage
              citations={chatMetadata?.citations ?? []}
              contentMarkdown={contentMarkdown}
              sessionId={sessionId}
              streaming={isStreamingChatMessage(message)}
            />
          ) : message.role === "assistant" ? (
            <StreamingAssistantPlaceholder />
          ) : (
            <UserChatBubble contentMarkdown={contentMarkdown} />
          )}
        </div>
      </Message>
    </div>
  )
}

export function DeepResearchSessionThread({
  initialThread,
  initialWorkspace,
  initialWorkspaces,
}: {
  initialThread: SessionThreadResponse
  initialWorkspace: WorkspaceDetail | null
  initialWorkspaces: WorkspaceSummary[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const {
    clarificationResponses,
    error,
    refreshThread,
    resumeRun,
    retryRun,
    session,
    setClarificationResponse,
    submissionAction,
    submittingRunId,
    thread,
  } = useSessionThread(initialThread)
  const [composerError, setComposerError] = useState<string | null>(null)
  const [launchingResearch, setLaunchingResearch] = useState(false)
  const [researchPrefill, setResearchPrefill] = useState<ResearchPrefill | null>(null)

  const currentSession = session ?? initialThread.session
  const currentWorkspaceId = currentSession.workspaceId
  const sessionMessages = thread?.messages ?? initialThread.messages
  const workspaceName = thread?.workspace?.name ?? initialThread.workspace?.name
  const activeMode: SessionComposerMode =
    searchParams.get("mode") === "research" ? "research" : "chat"
  const focusedRunId =
    searchParams.get("runId")?.trim() || currentSession.latestRunId || ""

  const {
    chatError,
    chatMessages,
    chatStatus,
    sendWorkspaceMessage,
    stopWorkspaceMessage,
  } = useSessionWorkspaceChat({
    onPersisted: refreshThread,
    sessionId: currentSession.id,
  })

  const activityRun =
    sessionMessages.find((message) => message.linkedRun?.id === focusedRunId)
      ?.linkedRun ??
    [...sessionMessages]
      .reverse()
      .find((message) => message.linkedRun)
      ?.linkedRun

  const combinedError = composerError ?? chatError ?? error
  const isChatSubmitting = chatStatus === "submitted" || chatStatus === "streaming"
  const scrolledRunIdRef = useRef<string | null>(null)

  useEffect(() => {
    const focusRunId = searchParams.get("runId")?.trim()
    if (!focusRunId) {
      scrolledRunIdRef.current = null
      return
    }

    if (scrolledRunIdRef.current === focusRunId) {
      return
    }

    const target = document.querySelector<HTMLElement>(
      `[data-run-id="${focusRunId}"]`,
    )
    if (!target) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      scrolledRunIdRef.current = focusRunId
      target.scrollIntoView({
        behavior: "smooth",
        block: "start",
      })
    }, 120)

    return () => window.clearTimeout(timeoutId)
  }, [searchParams])

  const handleModeChange = (mode: SessionComposerMode) => {
    startTransition(() => {
      router.replace(
        buildSessionThreadHref({
          mode,
          runId: focusedRunId || undefined,
          sessionId: currentSession.id,
        }),
      )
    })
  }

  const handleResearchSubmit = async ({
    selectedDocumentIds,
    text,
    workspaceId,
  }: {
    selectedDocumentIds: string[]
    text: string
    workspaceId: string
  }) => {
    setComposerError(null)
    setLaunchingResearch(true)

    try {
      const response = await fetch("/api/deep-research/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          selectedDocumentIds,
          sessionId: currentSession.id,
          topic: text,
          workspaceId,
        }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || "Failed to create research run.")
      }

      window.dispatchEvent(new Event("sessions-updated"))
      startTransition(() => {
        router.replace(
          buildSessionThreadHref({
            mode: "research",
            runId: payload.id,
            sessionId: currentSession.id,
          }),
        )
      })
      await refreshThread()
      setResearchPrefill(null)
    } catch (launchError) {
      setComposerError(
        launchError instanceof Error
          ? launchError.message
          : "Failed to create research run.",
      )
    } finally {
      setLaunchingResearch(false)
    }
  }

  const handleChatSubmit = async ({
    selectedDocumentIds,
    text,
  }: {
    selectedDocumentIds: string[]
    text: string
    workspaceId: string
  }) => {
    setComposerError(null)
    await sendWorkspaceMessage({
      selectedDocumentIds,
      text,
    })
  }

  const transientMessages = useMemo(
    () =>
      chatMessages.filter(
        (message) =>
          message.role === "assistant" ||
          extractUiMessageText(message).length > 0,
      ),
    [chatMessages],
  )
  const streamingScrollKey = useMemo(
    () =>
      transientMessages
        .filter((message) => message.role === "assistant")
        .map(
          (message) =>
            `${message.id}:${extractUiMessageText(message).length}:${
              isStreamingChatMessage(message) ? "streaming" : "idle"
            }`,
        )
        .join("|"),
    [transientMessages],
  )

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="min-w-0">
        <div className="flex min-h-[calc(100vh-14rem)] flex-1 flex-col bg-background">
          <Conversation className="min-h-0 flex-1" resize="instant">
            <StreamingChatAutoScroll scrollKey={streamingScrollKey} />

            <ConversationContent className="mx-auto w-full max-w-4xl gap-5 px-4 pb-64 pt-2 sm:px-6 sm:pb-72">
              {combinedError ? (
                <Card className="border border-destructive/30 bg-destructive/10 shadow-none">
                  <CardContent className="px-4 py-3 text-sm text-destructive">
                    {combinedError}
                  </CardContent>
                </Card>
              ) : null}

              {sessionMessages.map((message, index) => {
                const linkedRun = message.linkedRun
                const activeRateLimitRetry = linkedRun
                  ? extractActiveRateLimitRetry(linkedRun)
                  : null
                const preResearchPlan = linkedRun
                  ? extractPreResearchPlan(linkedRun.events)
                  : null
                const citedSources = linkedRun
                  ? extractSourcesFromReport(linkedRun.finalReportMarkdown)
                  : []
                const priorChatQuestion =
                  message.messageType === "chat" && message.role === "assistant"
                    ? [...sessionMessages.slice(0, index)]
                        .reverse()
                        .find(
                          (candidate) =>
                            candidate.messageType === "chat" &&
                            candidate.role === "user",
                        )?.contentMarkdown
                    : null

                return (
                  <div
                    key={message.id}
                    className="space-y-5"
                    data-run-id={linkedRun?.id}
                  >
                    <Message
                      from={message.role === "assistant" ? "assistant" : "user"}
                      className={
                        message.role === "assistant"
                          ? "ml-0 max-w-full"
                          : "max-w-[82%] sm:max-w-[76%]"
                      }
                    >
                      <div className="w-full">
                        {renderSessionMessageCard({
                          message,
                          onEscalate:
                            priorChatQuestion && message.messageType === "chat"
                              ? () => {
                                  handleModeChange("research")
                                  setResearchPrefill({
                                    text: buildEscalationPrompt(priorChatQuestion),
                                    token: Date.now(),
                                  })
                                }
                              : undefined,
                          sessionId: currentSession.id,
                        })}
                      </div>
                    </Message>

                    {linkedRun ? (
                      <>
                        <Message from="assistant" className="max-w-full">
                          <MessageContent className="w-full max-w-full bg-transparent p-0">
                            <DeepResearchLaunchStatusCard
                              activeRateLimitRetry={activeRateLimitRetry}
                              run={linkedRun}
                            />
                          </MessageContent>
                        </Message>

                        <Message from="assistant" className="max-w-full">
                          <MessageContent className="w-full max-w-full bg-transparent p-0">
                            <DeepResearchArtifactsPanel
                              activeRateLimitRetry={activeRateLimitRetry}
                              citedSources={citedSources}
                              preResearchPlan={preResearchPlan}
                              run={linkedRun}
                              selectedDocuments={linkedRun.selectedDocuments}
                              workspaceName={linkedRun.workspace?.name ?? workspaceName}
                            />
                          </MessageContent>
                        </Message>

                        {linkedRun.status === "needs_clarification" &&
                        linkedRun.clarificationQuestion ? (
                          <Message from="assistant" className="max-w-full">
                            <MessageContent className="w-full max-w-full bg-transparent p-0">
                              <DeepResearchClarificationCard
                                clarificationResponse={
                                  clarificationResponses[linkedRun.id] ?? ""
                                }
                                onClarificationResponseChange={(value) =>
                                  setClarificationResponse(linkedRun.id, value)
                                }
                                onResume={() => void resumeRun(linkedRun)}
                                question={linkedRun.clarificationQuestion}
                                submitting={
                                  submittingRunId === linkedRun.id &&
                                  submissionAction === "resume"
                                }
                              />
                            </MessageContent>
                          </Message>
                        ) : null}

                        {(linkedRun.status === "failed" ||
                          linkedRun.status === "timed_out") &&
                        (linkedRun.errorMessage || true) ? (
                          <Message from="assistant" className="max-w-full">
                            <MessageContent className="w-full max-w-full bg-transparent p-0">
                              <DeepResearchFailureCard
                                errorMessage={linkedRun.errorMessage}
                                onResume={() => void resumeRun(linkedRun)}
                                onRetry={() => void retryRun(linkedRun.id)}
                                submissionAction={
                                  submittingRunId === linkedRun.id
                                    ? submissionAction
                                    : null
                                }
                                submitting={submittingRunId === linkedRun.id}
                              />
                            </MessageContent>
                          </Message>
                        ) : null}

                        {linkedRun.finalReportMarkdown ? (
                          <Message from="assistant" className="max-w-full">
                            <MessageContent className="w-full max-w-full bg-transparent p-0">
                              <DeepResearchFinalReport
                                markdown={linkedRun.finalReportMarkdown}
                              />
                            </MessageContent>
                          </Message>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                )
              })}

              {transientMessages.map((message) => (
                <TransientChatMessage
                  key={message.id}
                  message={message}
                  sessionId={currentSession.id}
                />
              ))}

              {sessionMessages.length === 0 && transientMessages.length === 0 ? (
                <Card className="border border-border/60">
                  <CardContent className="px-4 py-4 text-sm text-muted-foreground">
                    This session does not have any persisted messages yet.
                  </CardContent>
                </Card>
              ) : null}
            </ConversationContent>

            <ConversationScrollButton className="bottom-52 sm:bottom-56" />
          </Conversation>

          <div className="sticky bottom-0 z-10 px-4 pb-4 pt-6 sm:px-6">
            <div className="relative">
              {activityRun?.events.length ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-[calc(100%-1.15rem)] z-0">
                  <div className="pointer-events-auto">
                    <DeepResearchActivityDrawer events={activityRun.events} />
                  </div>
                </div>
              ) : null}

              <div className="relative z-10">
                <SessionThreadComposer
                  chatSubmitStatus={chatStatus}
                  initialSelectedDocumentIds={
                    initialWorkspace?.documents.map(
                      (attachment) => attachment.documentId,
                    ) ?? []
                  }
                  initialWorkspace={initialWorkspace}
                  initialWorkspaceId={currentWorkspaceId}
                  initialWorkspaces={initialWorkspaces}
                  isChatSubmitting={isChatSubmitting}
                  isResearchSubmitting={launchingResearch}
                  mode={activeMode}
                  onChatSubmit={handleChatSubmit}
                  onModeChange={handleModeChange}
                  onStopChat={stopWorkspaceMessage}
                  onResearchSubmit={handleResearchSubmit}
                  prefill={researchPrefill}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

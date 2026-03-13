"use client"

import { useRouter, useSearchParams } from "next/navigation"
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { BookIcon, TelescopeIcon } from "lucide-react"
import { useStickToBottomContext } from "use-stick-to-bottom"

import {
  AskWorkspaceActivityDrawer,
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
import { Shimmer } from "@/components/ai-elements/shimmer"
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
  WorkspaceChatTraceEvent,
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

type SelectionPrefill = {
  documentIds: string[]
  token: number
}

function buildEscalationPrompt(question: string) {
  return question.trim()
}

function normalizeWorkspaceChatSourceType(citation: WorkspaceChatCitation) {
  return citation.sourceType === "generated_report" ||
    citation.sourceType === "research_report"
    ? "Generated report"
    : "Workspace document"
}

function buildWorkspaceChatSourceHref({
  citation,
  sessionId,
}: {
  citation: WorkspaceChatCitation
  sessionId: string
}) {
  if (citation.url) {
    return citation.url
  }

  if (citation.runId) {
    return buildSessionThreadHref({
      mode: "research",
      runId: citation.runId,
      sessionId,
    })
  }

  return undefined
}

function AssistantChatSources({
  citations,
  sessionId,
}: {
  citations: WorkspaceChatCitation[]
  sessionId: string
}) {
  if (citations.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge
        className="rounded-full border-0 bg-zinc-900/6 px-3 py-1 text-[0.72rem] font-medium tracking-[0.02em] text-zinc-700 shadow-none"
        variant="secondary"
      >
        <BookIcon className="size-3.5" />
        {citations.length} source{citations.length === 1 ? "" : "s"}
      </Badge>
      {citations.map((citation) => {
        const href = buildWorkspaceChatSourceHref({
          citation,
          sessionId,
        })
        const label = citation.locationLabel
          ? `${citation.title} · ${citation.locationLabel}`
          : citation.title
        const badge = (
          <Badge
            className="max-w-full rounded-full border-zinc-200 bg-white/80 px-3 py-1 text-[0.78rem] font-medium text-zinc-700 shadow-none"
            title={`${normalizeWorkspaceChatSourceType(citation)}${
              citation.excerpt ? `\n\n${citation.excerpt}` : ""
            }`}
            variant="outline"
          >
            <span className="max-w-[18rem] truncate">{label}</span>
          </Badge>
        )

        if (!href) {
          return <div key={citation.id}>{badge}</div>
        }

        return (
          <a
            className="inline-flex no-underline"
            href={href}
            key={citation.id}
            rel={citation.url ? "noreferrer" : undefined}
            target={citation.url ? "_blank" : undefined}
          >
            {badge}
          </a>
        )
      })}
    </div>
  )
}

function AssistantChatMessage({
  citations,
  contentMarkdown,
  onEscalate,
  sessionId,
}: {
  contentMarkdown: string
  citations: WorkspaceChatCitation[]
  onEscalate?: () => void
  sessionId: string
}) {
  return (
    <Card className={CHAT_MESSAGE_CARD_CLASS}>
      <CardContent className="space-y-4 px-4 py-4">
        <div className="space-y-3">
          <MessageResponse className={CHAT_MARKDOWN_CLASS}>
            {contentMarkdown}
          </MessageResponse>
        </div>

        <AssistantChatSources citations={citations} sessionId={sessionId} />

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

function StreamingAssistantPlaceholder({
  label = "Searching workspace knowledge",
}: {
  label?: string
}) {
  return (
    <div className="px-1 py-1">
      <Shimmer
        as="span"
        className="text-sm font-medium text-muted-foreground"
        duration={1.8}
      >
        {label}
      </Shimmer>
    </div>
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
        citations={chatMetadata?.sources ?? chatMetadata?.citations ?? []}
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

function getWorkspaceChatTraceEvents(
  message: SessionMessage,
): WorkspaceChatTraceEvent[] {
  if (message.messageType !== "chat" || message.role !== "assistant") {
    return []
  }

  const metadata = isWorkspaceChatMessageMetadata(message.metadata)
    ? message.metadata
    : null

  return metadata?.traceEvents ?? []
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
  const [selectionPrefill, setSelectionPrefill] = useState<SelectionPrefill | null>(
    null,
  )

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
    chatStatus,
    requestId: chatRequestId,
    sendWorkspaceMessage,
    stopWorkspaceMessage,
    transientAssistantMetadata,
    transientAssistantSources,
    transientAssistantText,
    transientTraceEvents,
    transientUserText,
  } = useSessionWorkspaceChat({
    onPersisted: async () => {
      await refreshThread()
      window.dispatchEvent(new Event("sessions-updated"))
    },
    sessionId: currentSession.id,
  })

  const activityRun =
    sessionMessages.find((message) => message.linkedRun?.id === focusedRunId)
      ?.linkedRun ??
    [...sessionMessages]
      .reverse()
      .find((message) => message.linkedRun)
      ?.linkedRun
  const latestPersistedChatTraceEvents = [...sessionMessages]
    .reverse()
    .find((message) => getWorkspaceChatTraceEvents(message).length > 0)
  const chatActivityEvents =
    transientTraceEvents.length > 0
      ? transientTraceEvents
      : latestPersistedChatTraceEvents
        ? getWorkspaceChatTraceEvents(latestPersistedChatTraceEvents)
        : []

  const combinedError = composerError ?? chatError ?? error
  const isChatSubmitting =
    chatStatus === "starting" ||
    chatStatus === "retrieving" ||
    chatStatus === "streaming"
  const launcherChatSubmitStatus =
    chatStatus === "streaming"
      ? "streaming"
      : isChatSubmitting
        ? "submitted"
        : chatStatus === "error"
          ? "error"
          : undefined
  const scrolledRunIdRef = useRef<string | null>(null)
  const handledAutostartKeyRef = useRef<string | null>(null)
  const researchLaunchControllerRef = useRef<AbortController | null>(null)

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
      const controller = new AbortController()
      researchLaunchControllerRef.current = controller
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
        signal: controller.signal,
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
      if (launchError instanceof Error && launchError.name === "AbortError") {
        return
      }

      setComposerError(
        launchError instanceof Error
          ? launchError.message
          : "Failed to create research run.",
      )
    } finally {
      researchLaunchControllerRef.current = null
      setLaunchingResearch(false)
    }
  }

  const handleStopResearchLaunch = useCallback(() => {
    researchLaunchControllerRef.current?.abort()
    researchLaunchControllerRef.current = null
    setLaunchingResearch(false)
  }, [])

  const handleChatSubmit = useCallback(
    async ({
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
    },
    [sendWorkspaceMessage],
  )

  const streamingScrollKey = useMemo(
    () => `${chatRequestId ?? "idle"}:${transientAssistantText.length}:${chatStatus}`,
    [chatRequestId, chatStatus, transientAssistantText.length],
  )

  useEffect(() => {
    if (activeMode !== "chat") {
      return
    }

    const autostart = searchParams.get("autostart")
    const prompt = searchParams.get("prompt")?.trim() ?? ""
    const selected = searchParams.get("selected")?.trim() ?? ""

    if (autostart !== "1" || !prompt) {
      return
    }

    const autostartKey = `${currentSession.id}:${prompt}:${selected}`
    if (handledAutostartKeyRef.current === autostartKey) {
      return
    }

    handledAutostartKeyRef.current = autostartKey
    const selectedDocumentIds = selected
      ? selected
          .split(",")
          .map((documentId) => documentId.trim())
          .filter(Boolean)
      : []

    setSelectionPrefill({
      documentIds: selectedDocumentIds,
      token: Date.now(),
    })

    startTransition(() => {
      router.replace(
        buildSessionThreadHref({
          mode: "chat",
          runId: focusedRunId || undefined,
          sessionId: currentSession.id,
        }),
      )
    })

    void handleChatSubmit({
      selectedDocumentIds,
      text: prompt,
      workspaceId: currentWorkspaceId,
    }).catch((launchError: unknown) => {
      setComposerError(
        launchError instanceof Error
          ? launchError.message
          : "Failed to start Ask Workspace.",
      )
    })
  }, [
    activeMode,
    currentSession.id,
    currentWorkspaceId,
    handleChatSubmit,
    focusedRunId,
    router,
    searchParams,
  ])

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
                                publishedDocument={linkedRun.publishedReportDocument}
                                runId={linkedRun.id}
                                sessionId={currentSession.id}
                                workspaceId={linkedRun.workspaceId}
                              />
                            </MessageContent>
                          </Message>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                )
              })}

              {transientUserText ? (
                <Message from="user" className="max-w-[82%] sm:max-w-[76%]">
                  <div className="w-full">
                    <UserChatBubble contentMarkdown={transientUserText} />
                  </div>
                </Message>
              ) : null}

              {isChatSubmitting && !transientAssistantText ? (
                <Message from="assistant" className="ml-0 max-w-full">
                  <div className="w-full">
                    <StreamingAssistantPlaceholder />
                  </div>
                </Message>
              ) : null}

              {transientAssistantText ? (
                <Message from="assistant" className="ml-0 max-w-full">
                  <div className="w-full">
                    <AssistantChatMessage
                      citations={
                        transientAssistantSources.length > 0
                          ? transientAssistantSources
                          : transientAssistantMetadata?.sources ??
                            transientAssistantMetadata?.citations ??
                            []
                      }
                      contentMarkdown={transientAssistantText}
                      sessionId={currentSession.id}
                    />
                  </div>
                </Message>
              ) : null}

              {sessionMessages.length === 0 &&
              !transientUserText &&
              !transientAssistantText &&
              !isChatSubmitting ? (
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
              {activeMode === "chat" && chatActivityEvents.length > 0 ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-[calc(100%-1.15rem)] z-0">
                  <div className="pointer-events-auto">
                    <AskWorkspaceActivityDrawer events={chatActivityEvents} />
                  </div>
                </div>
              ) : null}

              {activeMode !== "chat" && activityRun?.events.length ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-[calc(100%-1.15rem)] z-0">
                  <div className="pointer-events-auto">
                    <DeepResearchActivityDrawer events={activityRun.events} />
                  </div>
                </div>
              ) : null}

              <div className="relative z-10">
                <SessionThreadComposer
                  chatSubmitStatus={launcherChatSubmitStatus}
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
                  onStopResearch={handleStopResearchLaunch}
                  onResearchSubmit={handleResearchSubmit}
                  prefill={researchPrefill}
                  selectionPrefill={selectionPrefill}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

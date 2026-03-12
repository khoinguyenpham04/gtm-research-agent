"use client"

import { useSearchParams } from "next/navigation"
import { useEffect } from "react"

import { DeepResearchThreadLauncher } from "@/app/dashboard/chat/deep-research-thread-launcher"
import {
  DeepResearchActivityDrawer,
  DeepResearchArtifactsPanel,
  DeepResearchClarificationCard,
  DeepResearchFailureCard,
  DeepResearchFinalReport,
  DeepResearchLaunchStatusCard,
  DeepResearchPromptCard,
} from "@/components/deep-research/thread-ui"
import {
  extractActiveRateLimitRetry,
  extractPreResearchPlan,
  extractSourcesFromReport,
} from "@/components/deep-research/utils"
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import { Message, MessageContent } from "@/components/ai-elements/message"
import { useSessionThread } from "@/components/sessions/use-session-thread"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import type { SessionThreadResponse } from "@/lib/deep-research/types"
import type {
  WorkspaceDetail,
  WorkspaceSummary,
} from "@/lib/workspaces"

export function DeepResearchSessionThread({
  initialThread,
  initialWorkspace,
  initialWorkspaces,
}: {
  initialThread: SessionThreadResponse
  initialWorkspace: WorkspaceDetail | null
  initialWorkspaces: WorkspaceSummary[]
}) {
  const searchParams = useSearchParams()
  const {
    clarificationResponses,
    error,
    resumeRun,
    retryRun,
    session,
    setClarificationResponse,
    submissionAction,
    submittingRunId,
    thread,
  } = useSessionThread(initialThread)

  const currentWorkspaceId = session?.workspaceId ?? initialThread.session.workspaceId
  const sessionMessages = thread?.messages ?? initialThread.messages
  const currentSession = session ?? initialThread.session
  const workspaceName = thread?.workspace?.name ?? initialThread.workspace?.name
  const focusedRunId =
    searchParams.get("runId")?.trim() || currentSession.latestRunId || ""
  const activityRun =
    sessionMessages.find((message) => message.linkedRun?.id === focusedRunId)
      ?.linkedRun ??
    [...sessionMessages]
      .reverse()
      .find((message) => message.linkedRun)
      ?.linkedRun

  useEffect(() => {
    const focusRunId = searchParams.get("runId")?.trim()
    if (!focusRunId) {
      return
    }

    const target = document.querySelector<HTMLElement>(
      `[data-run-id="${focusRunId}"]`,
    )
    if (!target) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      target.scrollIntoView({
        behavior: "smooth",
        block: "start",
      })
    }, 120)

    return () => window.clearTimeout(timeoutId)
  }, [searchParams, sessionMessages])

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="min-w-0">
        <div className="flex min-h-[calc(100vh-14rem)] flex-1 flex-col bg-background">
          <Conversation className="min-h-0 flex-1">
            <ConversationContent className="mx-auto w-full max-w-4xl gap-5 px-4 py-2 sm:px-6">
              {error ? (
                <Card className="border border-destructive/30 bg-destructive/10 shadow-none">
                  <CardContent className="px-4 py-3 text-sm text-destructive">
                    {error}
                  </CardContent>
                </Card>
              ) : null}

              {sessionMessages.map((message) => {
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

                return (
                  <div
                    key={message.id}
                    className="space-y-5"
                    data-run-id={linkedRun?.id}
                  >
                    <Message from={message.role === "assistant" ? "assistant" : "user"} className="ml-0 max-w-full">
                      <div className="w-full">
                        {linkedRun ? (
                          <DeepResearchPromptCard
                            objective={linkedRun.objective}
                            selectedDocuments={linkedRun.selectedDocuments}
                            topic={linkedRun.topic}
                          />
                        ) : (
                          <Card className="border border-zinc-200 bg-white ring-0 shadow-none">
                            <CardContent className="px-4 py-4">
                              <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">
                                {message.contentMarkdown}
                              </p>
                            </CardContent>
                          </Card>
                        )}
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

              {sessionMessages.length === 0 ? (
                <Card className="border border-border/60">
                  <CardContent className="px-4 py-4 text-sm text-muted-foreground">
                    This session does not have any persisted messages yet.
                  </CardContent>
                </Card>
              ) : null}
            </ConversationContent>

            <ConversationScrollButton className="bottom-44" />
          </Conversation>

          <div className="sticky bottom-0 z-10 px-4 pb-4 pt-6 sm:px-6">
            <div className="relative">
              {activityRun?.events.length ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-[calc(100%-1.15rem)] z-0">
                  <div className="pointer-events-auto">
                    <DeepResearchActivityDrawer
                      events={activityRun.events}
                    />
                  </div>
                </div>
              ) : null}

              <div className="relative z-10">
              <DeepResearchThreadLauncher
                initialSelectedDocumentIds={
                  initialWorkspace?.documents.map((attachment) => attachment.documentId) ?? []
                }
                initialWorkspace={initialWorkspace}
                initialWorkspaceId={currentWorkspaceId}
                initialWorkspaces={initialWorkspaces}
                navigationMode="replace"
                sessionId={currentSession.id}
              />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

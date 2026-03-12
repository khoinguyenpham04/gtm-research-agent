"use client"

import { useSearchParams } from "next/navigation"
import { startTransition, useEffect, useState } from "react"

import { DeepResearchThreadLauncher } from "@/app/dashboard/chat/deep-research-thread-launcher"
import {
  DeepResearchActivityTimeline,
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
  formatTimestamp,
} from "@/components/deep-research/utils"
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import { Message, MessageContent } from "@/components/ai-elements/message"
import { useSessionThread } from "@/components/sessions/use-session-thread"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
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
  const [editingTitle, setEditingTitle] = useState(false)
  const [renameValue, setRenameValue] = useState(initialThread.session.title)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const {
    clarificationResponses,
    error,
    resumeRun,
    retryRun,
    session,
    setClarificationResponse,
    setThread,
    submissionAction,
    submittingRunId,
    thread,
  } = useSessionThread(initialThread)

  const currentWorkspaceId = session?.workspaceId ?? initialThread.session.workspaceId
  const sessionMessages = thread?.messages ?? initialThread.messages
  const currentSession = session ?? initialThread.session
  const workspaceName = thread?.workspace?.name ?? initialThread.workspace?.name

  useEffect(() => {
    setRenameValue(currentSession.title)
  }, [currentSession])

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

  const handleRename = async () => {
    const trimmedTitle = renameValue.trim()
    if (!trimmedTitle || trimmedTitle === currentSession.title) {
      setEditingTitle(false)
      setRenameValue(currentSession.title)
      setRenameError(null)
      return
    }

    setRenaming(true)
    setRenameError(null)

    try {
      const response = await fetch(`/api/sessions/${currentSession.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: trimmedTitle,
        }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || "Failed to rename session.")
      }

      startTransition(() => {
        setThread(
          thread
            ? {
                ...thread,
                session: payload,
              }
            : {
                ...initialThread,
                session: payload,
              },
        )
      })
      window.dispatchEvent(new Event("sessions-updated"))
      setEditingTitle(false)
    } catch (renameRequestError) {
      setRenameError(
        renameRequestError instanceof Error
          ? renameRequestError.message
          : "Failed to rename session.",
      )
    } finally {
      setRenaming(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="min-w-0">
        <Card className="border border-border/60">
          <CardHeader className="gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>{editingTitle ? "Rename session" : currentSession.title}</CardTitle>
                <CardDescription>
                  {workspaceName ?? "Unknown workspace"} · Updated{" "}
                  {formatTimestamp(currentSession.updatedAt)}
                </CardDescription>
              </div>

              {editingTitle ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    disabled={renaming || renameValue.trim().length === 0}
                    onClick={() => void handleRename()}
                  >
                    {renaming ? "Saving..." : "Save"}
                  </Button>
                  <Button
                    disabled={renaming}
                    onClick={() => {
                      setEditingTitle(false)
                      setRenameError(null)
                      setRenameValue(currentSession.title)
                    }}
                    variant="outline"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button onClick={() => setEditingTitle(true)} variant="outline">
                  Rename
                </Button>
              )}
            </div>

            {editingTitle ? (
              <div className="space-y-2">
                <Input
                  onChange={(event) => setRenameValue(event.target.value)}
                  value={renameValue}
                />
                {renameError ? (
                  <p className="text-sm text-destructive">{renameError}</p>
                ) : null}
              </div>
            ) : null}
          </CardHeader>
        </Card>

        <div className="mt-6 flex min-h-[calc(100vh-14rem)] flex-1 flex-col bg-background">
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
                  <div key={message.id} className="space-y-5">
                    <Message from={message.role === "assistant" ? "assistant" : "user"} className="ml-0 max-w-full">
                      <div className="w-full">
                        {linkedRun ? (
                          <DeepResearchPromptCard
                            objective={linkedRun.objective}
                            selectedDocuments={linkedRun.selectedDocuments}
                            topic={linkedRun.topic}
                            workspaceName={linkedRun.workspace?.name ?? workspaceName}
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

                        <Message
                          from="assistant"
                          className="max-w-full"
                          data-run-id={linkedRun.id}
                        >
                          <MessageContent className="w-full max-w-full bg-transparent p-0">
                            <Card className="border border-zinc-200 bg-white ring-0 shadow-none">
                              <CardHeader>
                                <CardTitle>Run details</CardTitle>
                                <CardDescription>
                                  Curated research context, sources, and raw orchestration history for this run.
                                </CardDescription>
                              </CardHeader>
                              <CardContent>
                                <Accordion defaultValue={["context"]} type="multiple">
                                  <AccordionItem value="context">
                                    <AccordionTrigger>Research context</AccordionTrigger>
                                    <AccordionContent>
                                      <DeepResearchArtifactsPanel
                                        activeRateLimitRetry={activeRateLimitRetry}
                                        citedSources={citedSources}
                                        preResearchPlan={preResearchPlan}
                                        run={linkedRun}
                                        selectedDocuments={linkedRun.selectedDocuments}
                                        workspaceName={
                                          linkedRun.workspace?.name ?? workspaceName
                                        }
                                      />
                                    </AccordionContent>
                                  </AccordionItem>
                                  <AccordionItem value="activity">
                                    <AccordionTrigger>Raw activity</AccordionTrigger>
                                    <AccordionContent>
                                      <DeepResearchActivityTimeline
                                        events={linkedRun.events}
                                      />
                                    </AccordionContent>
                                  </AccordionItem>
                                </Accordion>
                              </CardContent>
                            </Card>
                          </MessageContent>
                        </Message>
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

            <ConversationScrollButton className="bottom-36" />
          </Conversation>

          <div className="sticky bottom-0 z-10 border-t border-border/50 bg-background/92 px-4 pb-4 pt-4 backdrop-blur supports-[backdrop-filter]:bg-background/82 sm:px-6">
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
  )
}

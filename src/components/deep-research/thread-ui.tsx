"use client"

import Link from "next/link"
import { useEffect, useRef, useState, type ReactNode } from "react"

import type { DocumentSummary } from "@/lib/documents"
import type {
  DeepResearchRunEvent,
  DeepResearchRunResponse,
  PreResearchPlan,
} from "@/lib/deep-research/types"
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import { Message, MessageContent } from "@/components/ai-elements/message"
import type {
  DeepResearchRateLimitRetry,
  DeepResearchSourceLink,
} from "@/components/deep-research/utils"
import { formatTimestamp } from "@/components/deep-research/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { RunActivityStagePill } from "@/components/ui/run-activity-stage-pill"
import { StatusPill } from "@/components/ui/status-pill"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useStickToBottomContext } from "use-stick-to-bottom"

const THREAD_SURFACE_CARD_CLASS =
  "border border-zinc-200 bg-white ring-0 shadow-none"

const THREAD_INSET_SURFACE_CLASS = "border border-zinc-200 bg-white"

function StatusCopy({
  launchPending,
  run,
}: {
  launchPending?: boolean
  run: DeepResearchRunResponse | null
}) {
  if (launchPending) {
    return {
      description:
        "Creating the run, attaching the selected scope, and handing off to the research graph.",
      title: "Preparing deep research",
    }
  }

  if (!run) {
    return {
      description: "This thread will show the full deep research lifecycle.",
      title: "Research thread",
    }
  }

  switch (run.status) {
    case "queued":
    case "running":
      return {
        description:
          "The research graph is actively planning, retrieving, validating, and drafting.",
        title: "Research in progress",
      }
    case "needs_clarification":
      return {
        description:
          "The research graph paused because it needs a concrete clarification before continuing.",
        title: "Research paused for clarification",
      }
    case "completed":
      return {
        description:
          "The report is complete and the supporting plan and citations are available in this thread.",
        title: "Research completed",
      }
    case "failed":
    case "timed_out":
      return {
        description:
          "The run stopped before completion. You can resume from the latest checkpoint or retry it from this thread.",
        title: "Research stopped",
      }
    default:
      return {
        description: "This thread will show the full deep research lifecycle.",
        title: "Research thread",
      }
  }
}

export function DeepResearchPromptCard({
  objective,
  selectedDocuments,
  topic,
  workspaceName,
}: {
  topic: string
  objective?: string
  workspaceName?: string
  selectedDocuments: DocumentSummary[]
}) {
  return (
    <Card className={THREAD_SURFACE_CARD_CLASS}>
      <CardHeader className="gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Deep research</Badge>
          {workspaceName ? <Badge variant="outline">{workspaceName}</Badge> : null}
          <Badge variant="outline">
            {selectedDocuments.length} doc{selectedDocuments.length === 1 ? "" : "s"}
          </Badge>
        </div>

        <CardTitle className="whitespace-pre-wrap text-[1rem] leading-7 text-foreground">
          {topic}
        </CardTitle>

        {objective ? (
          <CardDescription className="leading-6">
            Objective: {objective}
          </CardDescription>
        ) : null}
      </CardHeader>

      {selectedDocuments.length > 0 ? (
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-2">
            {selectedDocuments.map((document) => (
              <Badge key={document.id} variant="outline">
                {document.file_name}
              </Badge>
            ))}
          </div>
        </CardContent>
      ) : null}
    </Card>
  )
}

export function DeepResearchLaunchStatusCard({
  activeRateLimitRetry,
  error,
  launchPending,
  run,
}: {
  run: DeepResearchRunResponse | null
  launchPending?: boolean
  error?: string | null
  activeRateLimitRetry?: DeepResearchRateLimitRetry | null
}) {
  const copy = StatusCopy({ launchPending, run })

  return (
    <Card className={THREAD_SURFACE_CARD_CLASS}>
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill
            status={
              launchPending ? "pending" : run?.status ?? "pending"
            }
            size="md"
          />
          {run ? (
            <span className="text-xs text-muted-foreground">
              Updated {formatTimestamp(run.updatedAt)}
            </span>
          ) : null}
        </div>

        {run ? (
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">{run.topic}</p>
            {run.objective ? (
              <p className="text-sm text-muted-foreground">{run.objective}</p>
            ) : null}
          </div>
        ) : null}

        {activeRateLimitRetry ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">Rate limited</Badge>
              <p className="text-sm font-medium">Retrying with backoff</p>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Attempt {activeRateLimitRetry.attempt} of{" "}
              {activeRateLimitRetry.maxAttempts}
              {activeRateLimitRetry.role
                ? ` · ${activeRateLimitRetry.role} model call`
                : ""}
              {` · waiting about ${(
                activeRateLimitRetry.delayMs / 1000
              ).toFixed(activeRateLimitRetry.delayMs >= 1000 ? 1 : 2)}s`}
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function DeepResearchActivityTimeline({
  events,
}: {
  events: DeepResearchRunEvent[]
}) {
  const { scrollToBottom } = useStickToBottomContext()
  const previousEventIdsRef = useRef(events.map((event) => event.id))
  const [freshEventIds, setFreshEventIds] = useState<string[]>([])

  useEffect(() => {
    const previousEventIds = new Set(previousEventIdsRef.current)
    const nextFreshEventIds = events
      .filter((event) => !previousEventIds.has(event.id))
      .map((event) => event.id)

    if (nextFreshEventIds.length === 0) {
      previousEventIdsRef.current = events.map((event) => event.id)
      return
    }

    setFreshEventIds(nextFreshEventIds)
    void scrollToBottom({
      animation: {
        damping: 0.78,
        mass: 1.05,
        stiffness: 0.06,
      },
      duration: 280,
      wait: 40,
    })

    previousEventIdsRef.current = events.map((event) => event.id)
    const timeoutId = window.setTimeout(() => {
      setFreshEventIds([])
    }, 700)

    return () => window.clearTimeout(timeoutId)
  }, [events, scrollToBottom])

  return (
    <Card className={THREAD_SURFACE_CARD_CLASS}>
      <CardHeader>
        <CardTitle>Research activity</CardTitle>
        <CardDescription>
          Fine-grained orchestration events persisted by the backend.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {events.length ? (
          <div className="space-y-3">
            {events.map((event) => (
              <div
                key={event.id}
                className={cn(
                  "rounded-xl border border-zinc-200 bg-white px-4 py-3",
                  freshEventIds.includes(event.id)
                    ? "animate-in fade-in-0 slide-in-from-bottom-3 duration-500"
                    : undefined,
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <RunActivityStagePill stage={event.stage} />
                  <p className="text-sm font-medium">{event.message}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {event.eventType} · {formatTimestamp(event.createdAt)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Activity will appear here once the run starts producing events.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export function DeepResearchClarificationCard({
  clarificationResponse,
  onClarificationResponseChange,
  onResume,
  question,
  submitting,
}: {
  question: string
  clarificationResponse: string
  onClarificationResponseChange: (value: string) => void
  onResume: () => void
  submitting?: boolean
}) {
  return (
    <Card className="border border-amber-500/35 bg-amber-500/10">
      <CardHeader>
        <CardTitle>Clarification required</CardTitle>
        <CardDescription>{question}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          className="min-h-28 bg-white"
          onChange={(event) => onClarificationResponseChange(event.target.value)}
          placeholder="Provide the missing detail so the run can continue."
          value={clarificationResponse}
        />
        <Button
          disabled={submitting || clarificationResponse.trim().length === 0}
          onClick={onResume}
        >
          {submitting ? "Resuming..." : "Resume research"}
        </Button>
      </CardContent>
    </Card>
  )
}

export function DeepResearchFailureCard({
  errorMessage,
  onResume,
  onRetry,
  submissionAction,
  submitting,
}: {
  errorMessage?: string
  onResume?: () => void
  onRetry?: () => void
  submissionAction?: "resume" | "retry" | null
  submitting?: boolean
}) {
  return (
    <Card className="border border-destructive/35 bg-destructive/10">
      <CardHeader>
        <CardTitle>Run error</CardTitle>
        <CardDescription>
          {errorMessage || "The run failed without an error message."}
        </CardDescription>
      </CardHeader>
      {onResume || onRetry ? (
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            {onResume ? (
              <Button disabled={submitting} onClick={onResume}>
                {submitting && submissionAction === "resume"
                  ? "Resuming..."
                  : "Resume from checkpoint"}
              </Button>
            ) : null}
            {onRetry ? (
              <Button
                disabled={submitting}
                onClick={onRetry}
                variant="outline"
              >
                {submitting && submissionAction === "retry"
                  ? "Retrying..."
                  : "Retry run"}
              </Button>
            ) : null}
          </div>
        </CardContent>
      ) : null}
    </Card>
  )
}

export function DeepResearchFinalReport({
  markdown,
}: {
  markdown?: string
}) {
  return (
    <Card className={THREAD_SURFACE_CARD_CLASS}>
      <CardHeader>
        <CardTitle>Final report</CardTitle>
        <CardDescription>
          The markdown report generated by the final writer node.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {markdown ? (
          <article className="max-h-[42rem] overflow-y-auto rounded-xl border border-zinc-200 bg-white px-4 py-4">
            <pre className="whitespace-pre-wrap text-sm leading-6">
              {markdown}
            </pre>
          </article>
        ) : (
          <p className="text-sm text-muted-foreground">
            The final report will appear here once the run completes.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function DeepResearchArtifactsPanel({
  activeRateLimitRetry,
  citedSources,
  preResearchPlan,
  run,
  selectedDocuments,
  workspaceName,
}: {
  run: DeepResearchRunResponse | null
  workspaceName?: string
  selectedDocuments: DocumentSummary[]
  preResearchPlan: PreResearchPlan | null
  citedSources: DeepResearchSourceLink[]
  activeRateLimitRetry?: DeepResearchRateLimitRetry | null
}) {
  return (
    <Card className={THREAD_SURFACE_CARD_CLASS}>
      <CardHeader className="pb-3">
        <CardTitle>Research context</CardTitle>
        <CardDescription>
          Scope, status, planning notes, and citations for this thread.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <Accordion
          className="w-full"
          defaultValue={["scope", "status"]}
          type="multiple"
        >
          <AccordionItem value="scope">
            <AccordionTrigger>Workspace scope</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {workspaceName ?? "Unknown workspace"}
                  </Badge>
                  <Badge variant="secondary">
                    {selectedDocuments.length} selected
                  </Badge>
                </div>

                {selectedDocuments.length ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedDocuments.map((document) => (
                      <Badge key={document.id} variant="outline">
                        {document.file_name}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No selected documents were attached to this launch scope.
                  </p>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="status">
            <AccordionTrigger>Current run</AccordionTrigger>
            <AccordionContent>
              {run ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill size="md" status={run.status} />
                    <span className="text-xs text-muted-foreground">
                      Updated {formatTimestamp(run.updatedAt)}
                    </span>
                  </div>

                  {activeRateLimitRetry ? (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-muted-foreground">
                      Attempt {activeRateLimitRetry.attempt} of{" "}
                      {activeRateLimitRetry.maxAttempts}
                      {activeRateLimitRetry.role
                        ? ` · ${activeRateLimitRetry.role}`
                        : ""}
                    </div>
                  ) : null}

                  {run.errorMessage ? (
                    <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                      {run.errorMessage}
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Run metadata will appear once the launch completes.
                </p>
              )}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="focus">
            <AccordionTrigger>Research focus</AccordionTrigger>
            <AccordionContent>
              {preResearchPlan ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{preResearchPlan.mode}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {preResearchPlan.coreQuestions.length} core questions
                    </span>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium">Core questions</p>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      {preResearchPlan.coreQuestions.map((question) => (
                        <li
                          key={question}
                          className={`${THREAD_INSET_SURFACE_CLASS} rounded-xl px-3 py-2`}
                        >
                          {question}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium">Evidence categories</p>
                    <div className="flex flex-wrap gap-2">
                      {preResearchPlan.requiredEvidenceCategories.map((category) => (
                        <Badge key={category} variant="secondary">
                          {category}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Planning details will appear once the run finishes its initial planning step.
                </p>
              )}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="sources">
            <AccordionTrigger>Cited sources</AccordionTrigger>
            <AccordionContent>
              {citedSources.length ? (
                <div className="space-y-3">
                  {citedSources.map((source) => (
                    <a
                      key={source.url}
                      className="block rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm hover:bg-zinc-50"
                      href={source.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <p className="font-medium">{source.label}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {source.url}
                      </p>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Source links will appear here once the report includes citations.
                </p>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  )
}

export function DeepResearchArtifactsRail({
  activeRateLimitRetry,
  citedSources,
  preResearchPlan,
  run,
  selectedDocuments,
  workspaceName,
}: {
  run: DeepResearchRunResponse | null
  workspaceName?: string
  selectedDocuments: DocumentSummary[]
  preResearchPlan: PreResearchPlan | null
  citedSources: DeepResearchSourceLink[]
  activeRateLimitRetry?: DeepResearchRateLimitRetry | null
}) {
  return (
    <div className="space-y-6 xl:sticky xl:top-6">
      <Card className={THREAD_SURFACE_CARD_CLASS}>
        <CardHeader>
          <CardTitle>Workspace scope</CardTitle>
          <CardDescription>
            The workspace and document subset used for this thread.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{workspaceName ?? "Unknown workspace"}</Badge>
            <Badge variant="secondary">
              {selectedDocuments.length} selected
            </Badge>
          </div>

          {selectedDocuments.length ? (
            <div className="flex flex-wrap gap-2">
              {selectedDocuments.map((document) => (
                <Badge key={document.id} variant="outline">
                  {document.file_name}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No selected documents were attached to this launch scope.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className={THREAD_SURFACE_CARD_CLASS}>
        <CardHeader>
          <CardTitle>Current run</CardTitle>
          <CardDescription>
            Status and metadata for this deep research execution.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {run ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill size="md" status={run.status} />
                <span className="text-xs text-muted-foreground">
                  Updated {formatTimestamp(run.updatedAt)}
                </span>
              </div>

              {activeRateLimitRetry ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-muted-foreground">
                  Attempt {activeRateLimitRetry.attempt} of{" "}
                  {activeRateLimitRetry.maxAttempts}
                  {activeRateLimitRetry.role
                    ? ` · ${activeRateLimitRetry.role}`
                    : ""}
                </div>
              ) : null}

              {run.errorMessage ? (
                    <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {run.errorMessage}
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Run metadata will appear once the launch completes.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className={THREAD_SURFACE_CARD_CLASS}>
        <CardHeader>
          <CardTitle>Research focus</CardTitle>
          <CardDescription>
            The pre-research plan that shaped the run.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {preResearchPlan ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{preResearchPlan.mode}</Badge>
                <span className="text-xs text-muted-foreground">
                  {preResearchPlan.coreQuestions.length} core questions
                </span>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Core questions</p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {preResearchPlan.coreQuestions.map((question) => (
                    <li
                      key={question}
                      className={`${THREAD_INSET_SURFACE_CLASS} rounded-xl px-3 py-2`}
                    >
                      {question}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Evidence categories</p>
                <div className="flex flex-wrap gap-2">
                  {preResearchPlan.requiredEvidenceCategories.map((category) => (
                    <Badge key={category} variant="secondary">
                      {category}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Planning details will appear once the run finishes its initial planning step.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className={THREAD_SURFACE_CARD_CLASS}>
        <CardHeader>
          <CardTitle>Cited sources</CardTitle>
          <CardDescription>
            Deduplicated links extracted from the final report.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {citedSources.length ? (
            <div className="space-y-3">
              {citedSources.map((source) => (
                <a
                  key={source.url}
                  className="block rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm hover:bg-zinc-50"
                  href={source.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  <p className="font-medium">{source.label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {source.url}
                  </p>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Source links will appear here once the report includes citations.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export function DeepResearchThreadShell({
  actions,
  activeRateLimitRetry,
  citedSources,
  clarificationResponse,
  composer,
  error,
  launchPending,
  onClarificationResponseChange,
  onResume,
  onRetry,
  preResearchPlan,
  run,
  selectedDocuments,
  submissionAction,
  topic,
  workspaceName,
  objective,
  submitting,
}: {
  topic: string
  objective?: string
  workspaceName?: string
  selectedDocuments: DocumentSummary[]
  run: DeepResearchRunResponse | null
  preResearchPlan: PreResearchPlan | null
  citedSources: DeepResearchSourceLink[]
  clarificationResponse: string
  onClarificationResponseChange: (value: string) => void
  launchPending?: boolean
  error?: string | null
  activeRateLimitRetry?: DeepResearchRateLimitRetry | null
  onResume?: () => void
  onRetry?: () => void
  submissionAction?: "resume" | "retry" | null
  submitting?: boolean
  actions?: ReactNode
  composer?: ReactNode
}) {
  return (
    <div className="flex min-h-[calc(100vh-9rem)] flex-1 flex-col bg-background">
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-4xl gap-5 px-4 py-8 sm:px-6">
          <Message from="user" className="ml-0 max-w-full">
            <div className="w-full">
              <DeepResearchPromptCard
                objective={objective}
                selectedDocuments={selectedDocuments}
                topic={topic}
                workspaceName={workspaceName}
              />
            </div>
          </Message>

          <Message from="assistant" className="max-w-full">
            <MessageContent className="w-full max-w-full bg-transparent p-0">
              <DeepResearchLaunchStatusCard
                activeRateLimitRetry={activeRateLimitRetry}
                error={error}
                launchPending={launchPending}
                run={run}
              />
            </MessageContent>
          </Message>

          {run ? (
            <Message from="assistant" className="max-w-full">
              <MessageContent className="w-full max-w-full bg-transparent p-0">
                <DeepResearchActivityTimeline events={run.events} />
              </MessageContent>
            </Message>
          ) : null}

          <Message from="assistant" className="max-w-full">
            <MessageContent className="w-full max-w-full bg-transparent p-0">
              <DeepResearchArtifactsPanel
                activeRateLimitRetry={activeRateLimitRetry}
                citedSources={citedSources}
                preResearchPlan={preResearchPlan}
                run={run}
                selectedDocuments={selectedDocuments}
                workspaceName={workspaceName}
              />
            </MessageContent>
          </Message>

          {run?.status === "needs_clarification" &&
          run.clarificationQuestion &&
          onResume ? (
            <Message from="assistant" className="max-w-full">
              <MessageContent className="w-full max-w-full bg-transparent p-0">
                <DeepResearchClarificationCard
                  clarificationResponse={clarificationResponse}
                  onClarificationResponseChange={onClarificationResponseChange}
                  onResume={onResume}
                  question={run.clarificationQuestion}
                  submitting={submitting}
                />
              </MessageContent>
            </Message>
          ) : null}

          {(run?.status === "failed" || run?.status === "timed_out") &&
          (run.errorMessage || onResume || onRetry) ? (
            <Message from="assistant" className="max-w-full">
              <MessageContent className="w-full max-w-full bg-transparent p-0">
                <DeepResearchFailureCard
                  errorMessage={run?.errorMessage}
                  onResume={onResume}
                  onRetry={onRetry}
                  submissionAction={submissionAction}
                  submitting={submitting}
                />
              </MessageContent>
            </Message>
          ) : null}

          {run?.finalReportMarkdown ? (
            <Message from="assistant" className="max-w-full">
              <MessageContent className="w-full max-w-full bg-transparent p-0">
                <DeepResearchFinalReport markdown={run.finalReportMarkdown} />
              </MessageContent>
            </Message>
          ) : null}

          {actions ? (
            <div className="flex flex-wrap items-center gap-3">
              {actions}
            </div>
          ) : null}
        </ConversationContent>

        <ConversationScrollButton className={composer ? "bottom-36" : undefined} />
      </Conversation>

      {composer ? (
        <div className="sticky bottom-0 z-10 border-t border-border/50 bg-background/92 px-4 pb-4 pt-4 backdrop-blur supports-[backdrop-filter]:bg-background/82 sm:px-6">
          {composer}
        </div>
      ) : null}
    </div>
  )
}

export function DeepResearchThreadRecoveryActions({
  fallbackHref = "/dashboard/deepresearch",
  homeHref = "/dashboard",
}: {
  homeHref?: string
  fallbackHref?: string
}) {
  return (
    <>
      <Button asChild>
        <Link href={homeHref}>Start another research</Link>
      </Button>
      <Button asChild variant="outline">
        <Link href={fallbackHref}>Open fallback console</Link>
      </Button>
    </>
  )
}

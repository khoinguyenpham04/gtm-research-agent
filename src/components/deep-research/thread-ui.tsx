"use client"

import Link from "next/link"
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react"
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  FileDownIcon,
  LibraryBigIcon,
} from "lucide-react"

import type { DocumentSummary } from "@/lib/documents"
import { DeepResearchReportRenderer } from "@/components/deep-research/report-renderer"
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
  const { containerRef, freshEventIds } = useResearchActivityFeed(events)

  return (
    <Card className={THREAD_SURFACE_CARD_CLASS}>
      <CardHeader>
        <CardTitle>Research activity</CardTitle>
        <CardDescription>
          Fine-grained orchestration events persisted by the backend.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResearchActivityEvents
          containerRef={containerRef}
          events={events}
          freshEventIds={freshEventIds}
          maxHeightClass="max-h-96"
        />
      </CardContent>
    </Card>
  )
}

export function DeepResearchActivityDrawer({
  events,
}: {
  events: DeepResearchRunEvent[]
}) {
  const [collapsedByUser, setCollapsedByUser] = useState(false)
  const expanded = !collapsedByUser
  const latestEvent = events.at(-1)
  const { containerRef, freshEventIds } = useResearchActivityFeed(events)

  if (events.length === 0) {
    return null
  }

  return (
    <div className="relative z-0 px-2">
      <div className="relative isolate mx-auto w-full max-w-3xl rounded-[1.75rem] border border-border/60 bg-background px-3 pt-2 shadow-[0_-18px_44px_rgba(15,23,42,0.08)] before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[1.9rem] before:bg-background/55 before:blur-[2px] before:content-[''] sm:px-4">
        <button
          className="flex w-full items-start justify-between gap-4 pb-5 pt-1 text-left"
          onClick={() => setCollapsedByUser((current) => !current)}
          type="button"
        >
          <p className="text-sm font-semibold text-foreground">
            Research activity
          </p>

          <div className="flex items-center gap-2">
            {latestEvent ? (
              <RunActivityStagePill stage={latestEvent.stage} />
            ) : null}
            {!expanded && latestEvent ? (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {formatTimestamp(latestEvent.createdAt)}
              </span>
            ) : null}
            <span className="text-xs text-muted-foreground">
              {events.length} event{events.length === 1 ? "" : "s"}
            </span>
            {expanded ? (
              <ChevronDownIcon className="size-4 text-muted-foreground" />
            ) : (
              <ChevronUpIcon className="size-4 text-muted-foreground" />
            )}
          </div>
        </button>

        <div
          className={cn(
            "overflow-hidden transition-[max-height,opacity] duration-300 ease-out",
            expanded ? "max-h-60 opacity-100" : "max-h-0 opacity-0",
          )}
        >
          <div className="pb-5">
            <ResearchActivityEvents
              containerRef={containerRef}
              events={events}
              freshEventIds={freshEventIds}
              maxHeightClass="max-h-40"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function useResearchActivityFeed(events: DeepResearchRunEvent[]) {
  const containerRef = useRef<HTMLDivElement>(null)
  const previousEventIdsRef = useRef(events.map((event) => event.id))
  const [freshEventIds, setFreshEventIds] = useState<string[]>([])

  useEffect(() => {
    const previousEventIds = new Set(previousEventIdsRef.current)
    const nextFreshEventIds = events
      .filter((event) => !previousEventIds.has(event.id))
      .map((event) => event.id)

    previousEventIdsRef.current = events.map((event) => event.id)

    if (nextFreshEventIds.length === 0) {
      return
    }

    setFreshEventIds(nextFreshEventIds)

    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: "smooth",
      })
    }

    const timeoutId = window.setTimeout(() => {
      setFreshEventIds([])
    }, 700)

    return () => window.clearTimeout(timeoutId)
  }, [events])

  return {
    containerRef,
    freshEventIds,
  }
}

function ResearchActivityEvents({
  containerRef,
  events,
  freshEventIds,
  maxHeightClass,
}: {
  events: DeepResearchRunEvent[]
  freshEventIds: string[]
  maxHeightClass: string
  containerRef: RefObject<HTMLDivElement | null>
}) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Activity will appear here once the run starts producing events.
      </p>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn(maxHeightClass, "space-y-3 overflow-y-auto pr-1")}
    >
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
            · {formatTimestamp(event.createdAt)}
          </p>
        </div>
      ))}
    </div>
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
  publishedDocument,
  runId,
  sessionId,
  workspaceId,
}: {
  markdown?: string
  publishedDocument?: DocumentSummary
  runId?: string
  sessionId?: string
  workspaceId?: string
}) {
  const copyTimeoutRef = useRef<number>(0)
  const [isCopied, setIsCopied] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [publishedDocumentState, setPublishedDocumentState] = useState<
    DocumentSummary | undefined
  >(publishedDocument)

  useEffect(() => {
    setPublishedDocumentState(publishedDocument)
  }, [publishedDocument])

  useEffect(
    () => () => {
      window.clearTimeout(copyTimeoutRef.current)
    },
    [],
  )

  const handleCopyMarkdown = async () => {
    if (!markdown || typeof window === "undefined") {
      return
    }

    if (!navigator?.clipboard?.writeText) {
      return
    }

    try {
      await navigator.clipboard.writeText(markdown)
      setIsCopied(true)
      window.clearTimeout(copyTimeoutRef.current)
      copyTimeoutRef.current = window.setTimeout(() => {
        setIsCopied(false)
      }, 2000)
    } catch {
      // Silently ignore clipboard failures for now.
    }
  }

  const handleAttachToWorkspace = async () => {
    if (!runId) {
      return
    }

    setPublishError(null)
    setIsPublishing(true)

    try {
      const response = await fetch(`/api/deep-research/runs/${runId}/attach-report`, {
        method: "POST",
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || "Failed to add report to workspace.")
      }

      if (payload.document) {
        setPublishedDocumentState(payload.document as DocumentSummary)
        window.dispatchEvent(
          new CustomEvent("workspace-knowledge-updated", {
            detail: {
              documentId: (payload.document as DocumentSummary).id,
              workspaceId,
            },
          }),
        )
      }
    } catch (error) {
      setPublishError(
        error instanceof Error ? error.message : "Failed to add report to workspace.",
      )
    } finally {
      setIsPublishing(false)
    }
  }

  const handleOpenPrintView = () => {
    if (!runId || !sessionId || typeof window === "undefined") {
      return
    }

    window.open(
      `/dashboard/chat/sessions/${sessionId}/reports/${runId}/print`,
      "_blank",
      "noopener,noreferrer",
    )
  }

  return (
    <Card className={THREAD_SURFACE_CARD_CLASS}>
      <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle>Final report</CardTitle>
          <CardDescription>
            Key findings with cited sources and grounded uploaded documents.
          </CardDescription>
        </div>
        {markdown ? (
          <div className="flex flex-wrap items-center gap-2">
            {runId ? (
              <Button
                className="rounded-full"
                disabled={isPublishing || Boolean(publishedDocumentState)}
                onClick={() => void handleAttachToWorkspace()}
                size="sm"
                type="button"
                variant={publishedDocumentState ? "secondary" : "outline"}
              >
                <LibraryBigIcon className="size-4" />
                {publishedDocumentState
                  ? "Added to workspace"
                  : isPublishing
                    ? "Adding..."
                    : "Add to workspace knowledge base"}
              </Button>
            ) : null}
            <Button
              className="rounded-full"
              onClick={() => void handleCopyMarkdown()}
              size="sm"
              type="button"
              variant="outline"
            >
              {isCopied ? (
                <CheckIcon className="size-4" />
              ) : (
                <CopyIcon className="size-4" />
              )}
              {isCopied ? "Copied" : "Copy markdown"}
            </Button>
            <Button
              className="rounded-full"
              disabled={!runId || !sessionId}
              onClick={handleOpenPrintView}
              size="sm"
              type="button"
              variant="outline"
            >
              <FileDownIcon className="size-4" />
              Open print / save PDF
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {markdown ? (
          <article className="max-h-168 overflow-y-auto rounded-xl border border-zinc-200 bg-white px-5 py-5 sm:px-7">
            <DeepResearchReportRenderer markdown={markdown} />
          </article>
        ) : (
          <p className="text-sm text-muted-foreground">
            The final report will appear here once the run completes.
          </p>
        )}

        {publishedDocumentState ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Added to the workspace library as{" "}
            <span className="font-medium text-foreground">
              {publishedDocumentState.file_name}
            </span>
            .
          </p>
        ) : null}

        {publishError ? (
          <p className="mt-3 text-sm text-destructive">{publishError}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function DeepResearchArtifactsPanel({
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
                <DeepResearchFinalReport
                  markdown={run.finalReportMarkdown}
                  publishedDocument={run.publishedReportDocument}
                  workspaceId={run.workspaceId}
                />
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
        <div className="sticky bottom-0 z-10 border-t border-border/50 bg-background/92 px-4 pb-4 pt-4 backdrop-blur supports-backdrop-filter:bg-background/82 sm:px-6">
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

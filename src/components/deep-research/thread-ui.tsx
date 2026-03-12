"use client"

import Link from "next/link"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type RefObject,
  type ReactNode,
} from "react"
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  FileDownIcon,
} from "lucide-react"

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
import {
  InlineCitation,
  InlineCitationCarousel,
  InlineCitationCarouselContent,
  InlineCitationCarouselHeader,
  InlineCitationCarouselIndex,
  InlineCitationCarouselItem,
  InlineCitationCarouselNext,
  InlineCitationCarouselPrev,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
  InlineCitationQuote,
  InlineCitationSource,
} from "@/components/ai-elements/inline-citation"
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

const REPORT_MARKDOWN_CLASS =
  "mx-auto w-full max-w-3xl text-[15px] leading-8 text-zinc-800 [&_a]:break-words [&_blockquote]:my-6 [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-300 [&_blockquote]:bg-zinc-50/60 [&_blockquote]:py-1 [&_blockquote]:pl-4 [&_blockquote]:text-zinc-700 [&_code]:rounded-md [&_code]:bg-zinc-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_em]:text-zinc-700 [&_h1]:mt-2 [&_h1]:mb-6 [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mt-10 [&_h2]:mb-4 [&_h2]:border-b [&_h2]:border-zinc-200 [&_h2]:pb-2 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mt-8 [&_h3]:mb-3 [&_h3]:text-xl [&_h3]:font-semibold [&_h4]:mt-6 [&_h4]:mb-2 [&_h4]:text-lg [&_h4]:font-semibold [&_hr]:my-8 [&_hr]:border-zinc-200 [&_li]:my-1.5 [&_li]:pl-1 [&_ol]:my-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6 [&_p]:my-5 [&_p]:text-zinc-800 [&_pre]:my-5 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-zinc-800 [&_pre]:bg-zinc-950 [&_pre]:p-4 [&_pre]:text-zinc-50 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold [&_table]:w-full [&_tbody_tr]:border-t [&_tbody_tr]:border-zinc-200 [&_thead]:border-b [&_thead]:border-zinc-300 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_ul]:my-5 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6"

function formatCitationHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return "Source"
  }
}

function formatCitationPath(url: string) {
  try {
    const path = new URL(url).pathname
    if (!path || path === "/") {
      return "Home"
    }

    const segments = path.split("/").filter(Boolean)
    return decodeURIComponent(segments.at(-1) ?? "Home")
  } catch {
    return "Reference"
  }
}

function citationTextFromChildren(children: ReactNode) {
  if (typeof children === "string") {
    return children.trim()
  }

  if (Array.isArray(children)) {
    const text = children
      .map((child) => (typeof child === "string" ? child : ""))
      .join(" ")
      .trim()
    return text || null
  }

  return null
}

function ReportCitationLink({
  children,
  href,
  ...props
}: ComponentPropsWithoutRef<"a">) {
  if (!href) {
    return <span>{children}</span>
  }

  const citationText = citationTextFromChildren(children)
  const sourceTitle = citationText || formatCitationPath(href)
  const sourceHost = formatCitationHost(href)

  return (
    <InlineCitation className="inline-flex items-center">
      <a
        className="text-primary underline underline-offset-4 hover:text-primary/80"
        href={href}
        rel="noreferrer"
        target="_blank"
        {...props}
      >
        {children}
      </a>

      <InlineCitationCard>
        <InlineCitationCardTrigger
          className="cursor-pointer"
          sources={[href]}
        />
        <InlineCitationCardBody>
          <InlineCitationCarousel>
            <InlineCitationCarouselHeader>
              <InlineCitationCarouselPrev />
              <InlineCitationCarouselNext />
              <InlineCitationCarouselIndex />
            </InlineCitationCarouselHeader>
            <InlineCitationCarouselContent>
              <InlineCitationCarouselItem>
                <InlineCitationSource
                  description={`Source: ${sourceHost}`}
                  title={sourceTitle}
                  url={href}
                />
                {citationText ? (
                  <InlineCitationQuote>{citationText}</InlineCitationQuote>
                ) : null}
              </InlineCitationCarouselItem>
            </InlineCitationCarouselContent>
          </InlineCitationCarousel>
        </InlineCitationCardBody>
      </InlineCitationCard>
    </InlineCitation>
  )
}

const REPORT_MARKDOWN_COMPONENTS: Components = {
  a: ReportCitationLink,
  table: ({ children }) => (
    <div className="my-6 overflow-x-auto rounded-xl border border-zinc-200">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
}

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
            expanded ? "max-h-[15rem] opacity-100" : "max-h-0 opacity-0",
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
}: {
  markdown?: string
}) {
  const reportRef = useRef<HTMLElement | null>(null)
  const copyTimeoutRef = useRef<number>(0)
  const [isCopied, setIsCopied] = useState(false)
  const [isSavingPdf, setIsSavingPdf] = useState(false)

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

  const handleDownloadPdf = async () => {
    if (!markdown || typeof window === "undefined") {
      return
    }

    const reportText = reportRef.current?.innerText?.trim() || markdown.trim()
    if (!reportText) {
      return
    }

    setIsSavingPdf(true)

    try {
      const { jsPDF } = await import("jspdf")
      const document = new jsPDF({
        format: "letter",
        unit: "pt",
      })

      const pageWidth = document.internal.pageSize.getWidth()
      const pageHeight = document.internal.pageSize.getHeight()
      const margin = 48
      const contentWidth = pageWidth - margin * 2
      const lineHeight = 18
      const paragraphSpacing = 10
      let currentY = margin

      document.setFont("helvetica", "bold")
      document.setFontSize(18)
      document.text("Deep Research Final Report", margin, currentY)
      currentY += 28

      document.setFont("helvetica", "normal")
      document.setFontSize(11)

      const paragraphs = reportText
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.replace(/\n/g, " ").trim())
        .filter(Boolean)

      for (const paragraph of paragraphs) {
        const lines = document.splitTextToSize(paragraph, contentWidth)

        for (const line of lines) {
          if (currentY > pageHeight - margin) {
            document.addPage()
            currentY = margin
          }

          document.text(line, margin, currentY)
          currentY += lineHeight
        }

        currentY += paragraphSpacing
      }

      document.save("deep-research-final-report.pdf")
    } finally {
      setIsSavingPdf(false)
    }
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
              disabled={isSavingPdf}
              onClick={() => void handleDownloadPdf()}
              size="sm"
              type="button"
              variant="outline"
            >
              <FileDownIcon className="size-4" />
              {isSavingPdf ? "Saving PDF..." : "Save PDF"}
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {markdown ? (
          <article
            className="max-h-168 overflow-y-auto rounded-xl border border-zinc-200 bg-white px-5 py-5 sm:px-7"
            ref={reportRef}
          >
            <div className={REPORT_MARKDOWN_CLASS}>
              <ReactMarkdown
                components={REPORT_MARKDOWN_COMPONENTS}
                remarkPlugins={[remarkGfm]}
              >
                {markdown}
              </ReactMarkdown>
            </div>
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

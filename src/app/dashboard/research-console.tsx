"use client"

import Link from "next/link"
import {
  startTransition,
  useEffect,
  useMemo,
  useState,
} from "react"

import type { DocumentSummary } from "@/lib/documents"
import type { DeepResearchRunResponse } from "@/lib/deep-research/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"

function statusVariant(status: DeepResearchRunResponse["status"]) {
  switch (status) {
    case "completed":
      return "default"
    case "failed":
    case "timed_out":
      return "destructive"
    default:
      return "secondary"
  }
}

function extractSourcesFromReport(markdown?: string) {
  if (!markdown) {
    return []
  }

  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g
  const sources = new Map<string, { label: string; url: string }>()
  for (const match of markdown.matchAll(linkPattern)) {
    const [, label, url] = match
    if (!sources.has(url)) {
      sources.set(url, { label, url })
    }
  }

  return Array.from(sources.values())
}

function formatTimestamp(value: string) {
  if (!value) {
    return "Unknown"
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-GB", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
}

export function DeepResearchConsole({
  initialDocuments,
}: {
  initialDocuments: DocumentSummary[]
}) {
  const [topic, setTopic] = useState("")
  const [objective, setObjective] = useState("")
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([])
  const [run, setRun] = useState<DeepResearchRunResponse | null>(null)
  const [clarificationResponse, setClarificationResponse] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeRun = run?.status === "queued" || run?.status === "running"
  const citedSources = useMemo(
    () => extractSourcesFromReport(run?.finalReportMarkdown),
    [run?.finalReportMarkdown]
  )

  useEffect(() => {
    if (!run?.id || !activeRun) {
      return
    }

    const intervalId = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/deep-research/runs/${run.id}`, {
          cache: "no-store",
        })
        const payload = await response.json()
        if (!response.ok) {
          throw new Error(payload.error || "Failed to poll research run.")
        }

        startTransition(() => {
          setRun(payload)
        })
      } catch (pollError) {
        const message =
          pollError instanceof Error
            ? pollError.message
            : "Failed to poll research run."
        setError(message)
      }
    }, 2500)

    return () => window.clearInterval(intervalId)
  }, [activeRun, run?.id])

  const toggleDocument = (documentId: string, checked: boolean) => {
    setSelectedDocumentIds((current) =>
      checked
        ? [...current, documentId]
        : current.filter((item) => item !== documentId)
    )
  }

  const handleStart = async () => {
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch("/api/deep-research/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topic,
          objective: objective || undefined,
          selectedDocumentIds,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create research run.")
      }

      startTransition(() => {
        setRun(payload)
        setClarificationResponse("")
      })
    } catch (startError) {
      setError(
        startError instanceof Error
          ? startError.message
          : "Failed to create research run."
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleResume = async () => {
    if (!run) {
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch(`/api/deep-research/runs/${run.id}/resume`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clarificationResponse,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to resume research run.")
      }

      startTransition(() => {
        setRun(payload)
        setClarificationResponse("")
      })
    } catch (resumeError) {
      setError(
        resumeError instanceof Error
          ? resumeError.message
          : "Failed to resume research run."
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleRetry = async () => {
    if (!run) {
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch(`/api/deep-research/runs/${run.id}/retry`, {
        method: "POST",
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to retry research run.")
      }

      startTransition(() => {
        setRun(payload)
      })
    } catch (retryError) {
      setError(
        retryError instanceof Error
          ? retryError.message
          : "Failed to retry research run."
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
      <div className="space-y-6">
        <Card className="border border-border/60">
          <CardHeader>
            <CardTitle>Start a research run</CardTitle>
            <CardDescription>
              Select the uploaded documents to ground the run, then let the
              server-side LangGraph workflow do the rest.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium">Topic</label>
              <textarea
                className="min-h-32 w-full rounded-xl border border-input bg-background px-3 py-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                placeholder="Example: Analyse the go-to-market implications of the uploaded analyst reports for entering the UK fintech segment in 2026."
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Objective (optional)</label>
              <Input
                placeholder="Example: Focus on ICP, market risks, pricing signals, and source-backed recommendations."
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Selected documents</p>
                  <p className="text-sm text-muted-foreground">
                    The researcher will only retrieve from the checked uploads.
                  </p>
                </div>
                <Badge variant="outline">
                  {selectedDocumentIds.length} selected
                </Badge>
              </div>

              {initialDocuments.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                  No uploaded documents are available yet.{" "}
                  <Link
                    className="font-medium text-foreground underline underline-offset-4"
                    href="/documents"
                  >
                    Upload documents first
                  </Link>
                  .
                </div>
              ) : (
                <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl border border-border/60 bg-muted/20 p-3">
                  {initialDocuments.map((document) => {
                    const checked = selectedDocumentIds.includes(document.id)
                    return (
                      <label
                        key={document.id}
                        className="flex cursor-pointer items-start gap-3 rounded-lg border border-transparent px-2 py-2 hover:border-border hover:bg-background"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) =>
                            toggleDocument(document.id, value === true)
                          }
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {document.file_name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {document.total_chunks} chunks
                          </p>
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={
                  submitting ||
                  topic.trim().length === 0 ||
                  selectedDocumentIds.length === 0
                }
                onClick={handleStart}
              >
                {submitting ? "Starting..." : "Run Deep Research"}
              </Button>
              <Button asChild variant="outline">
                <Link href="/documents">Open documents</Link>
              </Button>
            </div>

            {error ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border border-border/60">
          <CardHeader>
            <CardTitle>Run activity</CardTitle>
            <CardDescription>
              Fine-grained server-side progress events persisted for polling.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {run?.events.length ? (
              <div className="space-y-3">
                {run.events.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-xl border border-border/60 bg-background px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{event.stage}</Badge>
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
                Start a run to see progress events here.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border border-border/60">
          <CardHeader>
            <CardTitle>Final report</CardTitle>
            <CardDescription>
              The raw Markdown report generated by the final LangGraph writer
              node.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {run?.finalReportMarkdown ? (
              <article className="max-h-[42rem] overflow-y-auto rounded-xl border border-border/60 bg-background px-4 py-4">
                <pre className="whitespace-pre-wrap text-sm leading-6">
                  {run.finalReportMarkdown}
                </pre>
              </article>
            ) : (
              <p className="text-sm text-muted-foreground">
                The report will appear here once the run completes.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card className="border border-border/60">
          <CardHeader>
            <CardTitle>Current run</CardTitle>
            <CardDescription>
              Polling status for the latest deep research execution.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {run ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                  <span className="text-xs text-muted-foreground">
                    Updated {formatTimestamp(run.updatedAt)}
                  </span>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">{run.topic}</p>
                  {run.objective ? (
                    <p className="text-sm text-muted-foreground">
                      {run.objective}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Run scope</p>
                  <div className="flex flex-wrap gap-2">
                    {run.selectedDocuments.map((document) => (
                      <Badge key={document.id} variant="outline">
                        {document.file_name}
                      </Badge>
                    ))}
                  </div>
                </div>

                {run.status === "needs_clarification" ? (
                  <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">
                        Clarification required
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {run.clarificationQuestion}
                      </p>
                    </div>
                    <textarea
                      className="min-h-28 w-full rounded-xl border border-input bg-background px-3 py-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      placeholder="Provide the missing detail so the run can continue."
                      value={clarificationResponse}
                      onChange={(event) =>
                        setClarificationResponse(event.target.value)
                      }
                    />
                    <Button
                      disabled={submitting || clarificationResponse.trim().length === 0}
                      onClick={handleResume}
                    >
                      {submitting ? "Resuming..." : "Resume research"}
                    </Button>
                  </div>
                ) : null}

                {run.status === "failed" || run.status === "timed_out" ? (
                  <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Run error</p>
                      <p className="text-sm text-muted-foreground">
                        {run.errorMessage || "The run failed without an error message."}
                      </p>
                    </div>
                    <Button
                      disabled={submitting}
                      onClick={handleRetry}
                      variant="destructive"
                    >
                      {submitting ? "Retrying..." : "Retry run"}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No run started yet.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border border-border/60">
          <CardHeader>
            <CardTitle>Cited sources</CardTitle>
            <CardDescription>
              Deduplicated links extracted from the final Markdown report.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {citedSources.length ? (
              <div className="space-y-3">
                {citedSources.map((source) => (
                  <a
                    key={source.url}
                    className="block rounded-xl border border-border/60 bg-background px-3 py-3 text-sm hover:bg-muted/30"
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
                Source links will be extracted once the final report includes
                citations.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

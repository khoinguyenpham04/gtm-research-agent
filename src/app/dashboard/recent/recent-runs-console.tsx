"use client"

import Link from "next/link"
import { startTransition, useEffect, useMemo, useState } from "react"
import { ArrowRight, LoaderCircle } from "lucide-react"

import type {
  DeepResearchRunResponse,
  DeepResearchRunSummary,
} from "@/lib/deep-research/types"
import type { WorkspaceSummary } from "@/lib/workspaces"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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

export function RecentRunsConsole({
  initialRecentRuns,
  initialRun,
  initialWorkspaceId,
  initialWorkspaces,
}: {
  initialRecentRuns: DeepResearchRunSummary[]
  initialRun: DeepResearchRunResponse | null
  initialWorkspaceId: string
  initialWorkspaces: WorkspaceSummary[]
}) {
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(initialWorkspaceId)
  const [recentRuns, setRecentRuns] = useState(initialRecentRuns)
  const [run, setRun] = useState<DeepResearchRunResponse | null>(initialRun)
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null)
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeRun =
    run?.status === "queued" ||
    run?.status === "running" ||
    run?.status === "needs_clarification"
  const citedSources = useMemo(
    () => extractSourcesFromReport(run?.finalReportMarkdown),
    [run?.finalReportMarkdown],
  )

  useEffect(() => {
    let cancelled = false

    const loadRuns = async () => {
      try {
        setLoadingRuns(true)
        setError(null)

        const searchParams = new URLSearchParams()
        if (activeWorkspaceId) {
          searchParams.set("workspaceId", activeWorkspaceId)
        }

        const response = await fetch(
          `/api/deep-research/runs${searchParams.size ? `?${searchParams.toString()}` : ""}`,
          {
            cache: "no-store",
          },
        )
        const payload = await response.json()
        if (!response.ok) {
          throw new Error(payload.error || "Failed to load recent runs.")
        }

        if (cancelled) {
          return
        }

        startTransition(() => {
          setRecentRuns(payload)
          setRun((current) =>
            current && payload.some((item: DeepResearchRunSummary) => item.id === current.id)
              ? current
              : null,
          )
        })
      } catch (runsError) {
        if (!cancelled) {
          setError(
            runsError instanceof Error
              ? runsError.message
              : "Failed to load recent runs.",
          )
        }
      } finally {
        if (!cancelled) {
          setLoadingRuns(false)
        }
      }
    }

    void loadRuns()

    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId])

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
        setError(
          pollError instanceof Error
            ? pollError.message
            : "Failed to poll research run.",
        )
      }
    }, 2500)

    return () => window.clearInterval(intervalId)
  }, [activeRun, run?.id])

  const handleOpenSavedRun = async (runId: string) => {
    setLoadingRunId(runId)
    setError(null)

    try {
      const response = await fetch(`/api/deep-research/runs/${runId}`, {
        cache: "no-store",
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load saved research run.")
      }

      startTransition(() => {
        setRun(payload)
      })
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load saved research run.",
      )
    } finally {
      setLoadingRunId(null)
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.78fr)_minmax(0,1.2fr)]">
      <div className="space-y-6">
        <Card className="border border-border/60">
          <CardHeader>
            <CardTitle>Run browser</CardTitle>
            <CardDescription>
              Filter saved deep-research runs by workspace and reopen them here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Workspace</label>
              <Select
                onValueChange={setActiveWorkspaceId}
                value={activeWorkspaceId || undefined}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a workspace" />
                </SelectTrigger>
                <SelectContent>
                  {initialWorkspaces.map((workspace) => (
                    <SelectItem key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button asChild variant="outline">
                <Link href="/dashboard/deepresearch">
                  Open Deep Research
                  <ArrowRight className="size-4" />
                </Link>
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
            <CardTitle>Recent runs</CardTitle>
            <CardDescription>
              Saved runs for the selected workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingRuns ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                Loading runs...
              </div>
            ) : recentRuns.length ? (
              <div className="space-y-3">
                {recentRuns.map((item) => {
                  const isActive = run?.id === item.id
                  const isOpening = loadingRunId === item.id

                  return (
                    <button
                      key={item.id}
                      className={`block w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                        isActive
                          ? "border-primary/40 bg-primary/5"
                          : "border-border/60 bg-background hover:bg-muted/30"
                      }`}
                      onClick={() => void handleOpenSavedRun(item.id)}
                      type="button"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={statusVariant(item.status)}>
                          {item.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatTimestamp(item.updatedAt)}
                        </span>
                        {isOpening ? (
                          <LoaderCircle className="size-3 animate-spin text-muted-foreground" />
                        ) : null}
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm font-medium">
                        {item.topic}
                      </p>
                      {item.objective ? (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {item.objective}
                        </p>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
                No saved runs for this workspace yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card className="border border-border/60">
          <CardHeader>
            <CardTitle>Selected run</CardTitle>
            <CardDescription>
              Review the latest saved details without going back to the research setup view.
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
                <div className="space-y-2">
                  <p className="text-sm font-medium">{run.topic}</p>
                  {run.objective ? (
                    <p className="text-sm text-muted-foreground">
                      {run.objective}
                    </p>
                  ) : null}
                </div>
                {run.selectedDocuments.length ? (
                  <div className="flex flex-wrap gap-2">
                    {run.selectedDocuments.map((document) => (
                      <Badge key={document.id} variant="secondary">
                        {document.file_name}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
                Select a saved run to inspect its details.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border border-border/60">
          <CardHeader>
            <CardTitle>Run activity</CardTitle>
            <CardDescription>
              Fine-grained server-side progress events for the selected run.
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
                Activity for the selected run will appear here.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border border-border/60">
          <CardHeader>
            <CardTitle>Final report</CardTitle>
            <CardDescription>
              The saved Markdown report for the selected run.
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
                The final report will appear here once the selected run completes.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border border-border/60">
          <CardHeader>
            <CardTitle>Cited sources</CardTitle>
            <CardDescription>
              Deduplicated links extracted from the selected run&apos;s report.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {citedSources.length ? (
              <div className="space-y-3">
                {citedSources.map((source) => (
                  <div
                    key={source.url}
                    className="rounded-xl border border-border/60 bg-background px-3 py-3"
                  >
                    <p className="text-sm font-medium">{source.label}</p>
                    <a
                      className="mt-1 block text-xs text-muted-foreground underline underline-offset-4"
                      href={source.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {source.url}
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Source links will appear here once the selected run includes citations.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

"use client"

import Link from "next/link"
import { startTransition, useEffect, useMemo, useState } from "react"
import { ArrowRight, Database, FolderOpen, History, Search } from "lucide-react"

import type { DocumentSummary } from "@/lib/documents"
import type {
  DeepResearchRunResponse,
} from "@/lib/deep-research/types"
import type { WorkspaceDetail, WorkspaceSummary } from "@/lib/workspaces"
import {
  DeepResearchActivityTimeline,
  DeepResearchArtifactsRail,
  DeepResearchClarificationCard,
  DeepResearchFailureCard,
  DeepResearchFinalReport,
  DeepResearchLaunchStatusCard,
} from "@/components/deep-research/thread-ui"
import {
  extractActiveRateLimitRetry,
  extractPreResearchPlan,
  extractSourcesFromReport,
  formatFileSize,
} from "@/components/deep-research/utils"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

export function DeepResearchConsole({
  initialDocuments,
  initialObjective = "",
  initialSelectedDocumentIds = [],
  initialTopic = "",
  initialWorkspace,
  initialWorkspaceId,
  initialWorkspaces,
}: {
  initialDocuments: DocumentSummary[]
  initialObjective?: string
  initialSelectedDocumentIds?: string[]
  initialTopic?: string
  initialWorkspace: WorkspaceDetail | null
  initialWorkspaceId?: string
  initialWorkspaces: WorkspaceSummary[]
}) {
  const [topic, setTopic] = useState(initialTopic)
  const [objective, setObjective] = useState(initialObjective)
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>(
    initialSelectedDocumentIds,
  )
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(
    initialWorkspace,
  )
  const [workspaces, setWorkspaces] = useState(initialWorkspaces)
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(
    initialWorkspaceId ?? initialWorkspace?.id ?? initialWorkspaces[0]?.id ?? "",
  )
  const [workspaceName, setWorkspaceName] = useState("")
  const [run, setRun] = useState<DeepResearchRunResponse | null>(null)
  const [clarificationResponse, setClarificationResponse] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeRun = run?.status === "queued" || run?.status === "running"
  const citedSources = useMemo(
    () => extractSourcesFromReport(run?.finalReportMarkdown),
    [run?.finalReportMarkdown],
  )
  const preResearchPlan = useMemo(
    () => extractPreResearchPlan(run?.events),
    [run?.events],
  )
  const activeRateLimitRetry = useMemo(
    () => extractActiveRateLimitRetry(run),
    [run],
  )
  const selectedDocumentIdSet = useMemo(
    () => new Set(selectedDocumentIds),
    [selectedDocumentIds],
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
        setError(
          pollError instanceof Error
            ? pollError.message
            : "Failed to poll research run.",
        )
      }
    }, 2500)

    return () => window.clearInterval(intervalId)
  }, [activeRun, run?.id])

  useEffect(() => {
    if (!activeWorkspaceId || workspace?.id === activeWorkspaceId) {
      return
    }

    let cancelled = false
    const loadWorkspace = async () => {
      try {
        setWorkspaceLoading(true)
        const response = await fetch(`/api/workspaces/${activeWorkspaceId}`, {
          cache: "no-store",
        })
        const payload = await response.json()
        if (!response.ok) {
          throw new Error(payload.error || "Failed to load workspace.")
        }
        if (cancelled) {
          return
        }

        startTransition(() => {
          setWorkspace(payload)
          setSelectedDocumentIds([])
        })
      } catch (workspaceError) {
        if (!cancelled) {
          setError(
            workspaceError instanceof Error
              ? workspaceError.message
              : "Failed to load workspace.",
          )
        }
      } finally {
        if (!cancelled) {
          setWorkspaceLoading(false)
        }
      }
    }

    void loadWorkspace()
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId, workspace?.id])

  useEffect(() => {
    const workspaceDocumentIds = new Set(
      workspace?.documents.map((attachment) => attachment.documentId) ?? [],
    )
    setSelectedDocumentIds((current) =>
      current.filter((documentId) => workspaceDocumentIds.has(documentId)),
    )
  }, [workspace?.documents])

  const selectedDocuments =
    workspace?.documents.filter((attachment) =>
      selectedDocumentIdSet.has(attachment.documentId),
    ) ?? []

  const handleCreateWorkspace = async () => {
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: workspaceName }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create workspace.")
      }

      startTransition(() => {
        setWorkspaces((current) => [payload, ...current])
        setActiveWorkspaceId(payload.id)
        setWorkspaceName("")
      })
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Failed to create workspace.",
      )
    } finally {
      setSubmitting(false)
    }
  }

  const toggleDocument = (documentId: string, checked: boolean) => {
    setSelectedDocumentIds((current) =>
      checked
        ? [...new Set([...current, documentId])]
        : current.filter((item) => item !== documentId),
    )
  }

  const handleStart = async () => {
    if (!activeWorkspaceId) {
      setError("Create or select a workspace before starting a run.")
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch("/api/deep-research/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
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
          : "Failed to create research run.",
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
          : "Failed to resume research run.",
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
          : "Failed to retry research run.",
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
      <div className="space-y-6">
        <Card className="border border-border/60">
          <CardHeader>
            <CardTitle>Run setup</CardTitle>
            <CardDescription>
              Pick a workspace, choose its working-set documents, and keep file
              organization in the dedicated data library.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
              <div className="space-y-2">
                <label className="text-sm font-medium">Active workspace</label>
                <Select
                  onValueChange={setActiveWorkspaceId}
                  value={activeWorkspaceId || undefined}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Create or select a workspace" />
                  </SelectTrigger>
                  <SelectContent>
                    {workspaces.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Quick workspace</label>
                <div className="flex gap-2">
                  <Input
                    placeholder="New workspace"
                    value={workspaceName}
                    onChange={(event) => setWorkspaceName(event.target.value)}
                  />
                  <Button
                    disabled={submitting || workspaceName.trim().length === 0}
                    onClick={handleCreateWorkspace}
                    variant="outline"
                  >
                    Create
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Card className="border border-border/60 bg-muted/20">
                <CardContent className="flex items-center gap-3 p-4">
                  <FolderOpen className="size-5 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Workspace docs</p>
                    <p className="text-lg font-semibold">
                      {workspace?.documents.length ?? 0}
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border border-border/60 bg-muted/20">
                <CardContent className="flex items-center gap-3 p-4">
                  <Database className="size-5 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Global docs</p>
                    <p className="text-lg font-semibold">
                      {initialDocuments.length}
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border border-border/60 bg-muted/20">
                <CardContent className="flex items-center gap-3 p-4">
                  <Search className="size-5 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Selected for run</p>
                    <p className="text-lg font-semibold">
                      {selectedDocumentIds.length}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button asChild variant="outline">
                <Link href="/dashboard/data-library">
                  Open data library
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={workspace?.id ? `/dashboard?mode=chat&workspaceId=${workspace.id}` : "/dashboard?mode=chat"}>
                  Open Ask Workspace
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/dashboard/recent">
                  Open Recent Runs
                  <History className="size-4" />
                </Link>
              </Button>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Topic</label>
              <Textarea
                className="min-h-32"
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

            <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Workspace working set</p>
                  <p className="text-sm text-muted-foreground">
                    Only documents attached to the active workspace are shown
                    here.
                  </p>
                </div>
                <Badge variant="outline">
                  {workspaceLoading ? "Loading..." : `${selectedDocumentIds.length} selected`}
                </Badge>
              </div>

              {!workspace ? (
                <p className="text-sm text-muted-foreground">
                  Create a workspace, then use the data library to attach
                  documents into it.
                </p>
              ) : workspace.documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This workspace has no attached documents yet. Manage it in{" "}
                  <Link className="underline" href="/dashboard/data-library">
                    Data Library
                  </Link>
                  .
                </p>
              ) : (
                <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-border/60 bg-background p-3">
                  {workspace.documents.map((attachment) => (
                    <label
                      key={attachment.documentId}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-transparent px-2 py-2 hover:border-border hover:bg-muted/40"
                    >
                      <Checkbox
                        checked={selectedDocumentIdSet.has(attachment.documentId)}
                        onCheckedChange={(value) =>
                          toggleDocument(attachment.documentId, value === true)
                        }
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {attachment.document.file_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {attachment.document.total_chunks} chunks
                          {attachment.folderId ? " · filed" : " · root"}
                          {" · "}
                          {formatFileSize(attachment.document.file_size)}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {selectedDocuments.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {selectedDocuments.map((attachment) => (
                  <Badge key={attachment.documentId} variant="secondary">
                    {attachment.document.file_name}
                  </Badge>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={
                  submitting ||
                  topic.trim().length === 0 ||
                  selectedDocumentIds.length === 0 ||
                  !activeWorkspaceId
                }
                onClick={handleStart}
              >
                {submitting ? "Starting..." : "Run Deep Research"}
              </Button>
            </div>

            {error ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <DeepResearchLaunchStatusCard
          activeRateLimitRetry={activeRateLimitRetry}
          error={error}
          run={run}
        />

        {run?.status === "needs_clarification" && run.clarificationQuestion ? (
          <DeepResearchClarificationCard
            clarificationResponse={clarificationResponse}
            onClarificationResponseChange={setClarificationResponse}
            onResume={() => void handleResume()}
            question={run.clarificationQuestion}
            submitting={submitting}
          />
        ) : null}

        {run?.status === "failed" || run?.status === "timed_out" ? (
          <DeepResearchFailureCard
            errorMessage={run.errorMessage}
            onRetry={() => void handleRetry()}
            submitting={submitting}
          />
        ) : null}

        <DeepResearchActivityTimeline events={run?.events ?? []} />

        <DeepResearchFinalReport markdown={run?.finalReportMarkdown} />
      </div>

      <DeepResearchArtifactsRail
        activeRateLimitRetry={activeRateLimitRetry}
        citedSources={citedSources}
        preResearchPlan={preResearchPlan}
        run={run}
        selectedDocuments={run?.selectedDocuments ?? []}
        workspaceName={run?.workspace?.name ?? workspace?.name}
      />
    </div>
  )
}

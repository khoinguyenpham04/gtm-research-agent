"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { startTransition, useCallback, useEffect, useMemo, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowRight01Icon,
  BubbleChatSearchIcon,
  ChartAnalysisIcon,
  ChartBarLineIcon,
  DashboardSquare02Icon,
  DatabaseSync01Icon,
  DocumentValidationIcon,
  Telescope01Icon,
} from "@hugeicons/core-free-icons"

import type { SessionSummary } from "@/lib/deep-research/types"
import type { WorkspaceDetail, WorkspaceSummary } from "@/lib/workspaces"
import {
  PromptInputProvider,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input"
import { buildSessionThreadHref } from "@/components/deep-research/utils"
import {
  DashboardResearchLauncher,
  type ResearchPlay,
} from "@/app/dashboard/dashboard-research-launcher"
import { Button } from "@/components/ui/button"
import { StatusPill } from "@/components/ui/status-pill"
import { cn } from "@/lib/utils"

const researchPlays: ResearchPlay[] = [
  {
    title: "Market Entry Brief",
    description:
      "Size the opportunity, identify risks, and summarize the launch path for a new market.",
    topic:
      "Assess the go-to-market opportunity for entering a new market with an evidence-backed executive brief. Focus on market size inputs, adoption signals, buyer segments, compliance risks, and a pragmatic launch recommendation.",
    icon: ChartAnalysisIcon,
  },
  {
    title: "Competitive Landscape",
    description:
      "Map direct and adjacent competitors, pricing signals, and strategic whitespace.",
    topic:
      "Analyze the competitive landscape for this category and identify the strongest differentiation opportunities. Compare leading competitors, pricing models, positioning, and notable product gaps.",
    icon: DashboardSquare02Icon,
  },
  {
    title: "ICP Discovery",
    description:
      "Clarify who the most promising buyers are and what workflows make them receptive.",
    topic:
      "Define the ideal customer profile and buyer segments for this product opportunity. Focus on buyer roles, pain points, adoption readiness, and segment-specific signals.",
    icon: BubbleChatSearchIcon,
  },
  {
    title: "Pricing & Packaging Scan",
    description:
      "Gather pricing cues, willingness-to-pay signals, and packaging norms across the market.",
    topic:
      "Research pricing and packaging patterns relevant to this enterprise go-to-market decision. Surface price points, packaging structures, and evidence-backed monetization signals.",
    icon: ChartBarLineIcon,
  },
  {
    title: "Regulatory / Compliance Scan",
    description:
      "Review policy, privacy, and operational constraints that could shape rollout decisions.",
    topic:
      "Assess the compliance and regulatory considerations relevant to this product launch. Focus on privacy, sector-specific requirements, consent, and risk controls that affect adoption.",
    icon: DocumentValidationIcon,
  },
  {
    title: "Board / Leadership Update",
    description:
      "Generate a concise strategic brief with evidence, assumptions, and unresolved gaps for leadership.",
    topic:
      "Prepare a leadership-ready market update for this go-to-market initiative. Summarize market momentum, strategic risks, key assumptions, and the most important next decisions.",
    icon: DatabaseSync01Icon,
  },
]

function HomeIcon({
  icon,
  className,
  size = 20,
}: {
  icon: unknown
  className?: string
  size?: number
}) {
  return (
    <HugeiconsIcon
      aria-hidden="true"
      className={className}
      color="currentColor"
      icon={icon as never}
      size={size}
      strokeWidth={1.8}
    />
  )
}

function DashboardHomeContent({
  initialSelectedDocumentIds,
  initialSessions,
  initialWorkspace,
  initialWorkspaces,
}: {
  initialSelectedDocumentIds?: string[]
  initialSessions: SessionSummary[]
  initialWorkspace: WorkspaceDetail | null
  initialWorkspaces: WorkspaceSummary[]
}) {
  const router = useRouter()
  const promptController = usePromptInputController()
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(
    initialWorkspace?.id ?? initialWorkspaces[0]?.id ?? "",
  )
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(
    initialWorkspace,
  )
  const [workspaces, setWorkspaces] = useState(initialWorkspaces)
  const [sessions, setSessions] = useState(initialSessions)
  const [launchingResearch, setLaunchingResearch] = useState(false)
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>(
    initialSelectedDocumentIds && initialSelectedDocumentIds.length > 0
      ? initialSelectedDocumentIds
      : initialWorkspace?.documents.map((attachment) => attachment.documentId) ?? [],
  )
  const [loadingWorkspace, setLoadingWorkspace] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshWorkspaceContext = useCallback(async (workspaceId: string) => {
    if (!workspaceId) {
      startTransition(() => {
        setWorkspace(null)
        setSessions([])
      })
      return
    }

    setLoadingWorkspace(true)
    setError(null)

    try {
      const [workspaceResponse, sessionsResponse] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}`, {
          cache: "no-store",
        }),
        fetch(`/api/sessions?workspaceId=${workspaceId}`, {
          cache: "no-store",
        }),
      ])

      const [workspacePayload, sessionsPayload] = await Promise.all([
        workspaceResponse.json(),
        sessionsResponse.json(),
      ])

      if (!workspaceResponse.ok) {
        throw new Error(workspacePayload.error || "Failed to load workspace.")
      }

      if (!sessionsResponse.ok) {
        throw new Error(sessionsPayload.error || "Failed to load sessions.")
      }

      startTransition(() => {
        setWorkspace(workspacePayload)
        setSessions(sessionsPayload)
        setSelectedDocumentIds(
          workspacePayload.documents.map(
            (attachment: WorkspaceDetail["documents"][number]) =>
              attachment.documentId,
          ),
        )
      })
    } catch (workspaceError) {
      setError(
        workspaceError instanceof Error
          ? workspaceError.message
          : "Failed to load workspace context.",
      )
      throw workspaceError
    } finally {
      setLoadingWorkspace(false)
    }
  }, [])

  const refreshWorkspaces = useCallback(async () => {
    const response = await fetch("/api/workspaces", {
      cache: "no-store",
    })
    const payload = await response.json()

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load workspaces.")
    }

    startTransition(() => {
      setWorkspaces(payload.workspaces)
    })
  }, [])

  const handleWorkspaceRefresh = useCallback(
    async (workspaceId: string) => {
      await Promise.all([
        refreshWorkspaceContext(workspaceId),
        refreshWorkspaces(),
      ])
    },
    [refreshWorkspaceContext, refreshWorkspaces],
  )

  useEffect(() => {
    if (!activeWorkspaceId) {
      startTransition(() => {
        setWorkspace(null)
        setSessions([])
      })
      return
    }

    if (workspace?.id === activeWorkspaceId) {
      return
    }

    let cancelled = false

    void refreshWorkspaceContext(activeWorkspaceId).catch(() => {
      if (cancelled) {
        return
      }
    })

    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId, refreshWorkspaceContext, workspace?.id])

  useEffect(() => {
    const workspaceDocumentIds = new Set(
      workspace?.documents.map((attachment) => attachment.documentId) ?? [],
    )

    setSelectedDocumentIds((current) =>
      current.filter((documentId) => workspaceDocumentIds.has(documentId)),
    )
  }, [workspace?.documents])

  const latestSession = useMemo(() => sessions[0] ?? null, [sessions])
  const topic = promptController.textInput.value
  const workspaceDocumentCount = workspace?.documents.length ?? 0
  const handleStartNewSession = useCallback(() => {
    promptController.textInput.setInput("")
    const launcher = document.getElementById("dashboard-launcher")
    launcher?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    })
  }, [promptController.textInput])

  const handleLaunch = async (submittedTopic?: string) => {
    const nextTopic = (submittedTopic ?? topic).trim()
    if (!nextTopic) {
      return
    }

    if (!activeWorkspaceId) {
      setError("Select a workspace before launching deep research.")
      return
    }

    const launchKey = crypto.randomUUID()
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 15000)

    setError(null)
    setLaunchingResearch(true)

    try {
      const response = await fetch("/api/deep-research/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          launchKey,
          selectedDocumentIds,
          topic: nextTopic,
          workspaceId: activeWorkspaceId,
        }),
        signal: controller.signal,
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || "Failed to create research run.")
      }

      if (!payload.sessionId) {
        throw new Error("Research run did not return an owning session.")
      }

      window.dispatchEvent(new Event("sessions-updated"))
      startTransition(() => {
        router.push(
          buildSessionThreadHref({
            mode: "research",
            runId: payload.id,
            sessionId: payload.sessionId,
          }),
        )
      })
    } catch (launchError) {
      setError(
        launchError instanceof Error && launchError.name === "AbortError"
          ? "Launching deep research is taking longer than expected. Please try again."
          : launchError instanceof Error
            ? launchError.message
            : "Failed to create research run.",
      )
    } finally {
      window.clearTimeout(timeoutId)
      setLaunchingResearch(false)
    }
  }

  const applyResearchPlay = (play: ResearchPlay) => {
    promptController.textInput.setInput(play.topic)
  }

  return (
    <div className="flex flex-1 flex-col py-2 lg:py-4">
      <div className="mx-auto flex w-full max-w-[92rem] flex-1 px-1 sm:px-2">
        <div className="relative flex min-w-0 flex-1 flex-col gap-12">
          <section className="mx-auto flex w-full max-w-4xl flex-col items-center gap-4 pt-8 text-center lg:pt-14">
            <div className="mb-4 flex items-center">
              <div className="flex size-13.25 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-950">
                <HomeIcon icon={ChartAnalysisIcon} size={26} className="text-violet-500" />
              </div>
              <div className="relative z-10 -mx-2 flex size-18.5 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950">
                <HomeIcon icon={Telescope01Icon} size={36} className="text-blue-500" />
              </div>
              <div className="flex size-13.25 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950">
                <HomeIcon icon={DocumentValidationIcon} size={26} className="text-emerald-500" />
              </div>
            </div>

            <div className="max-w-3xl space-y-3">
              <h1 className="text-balance text-5xl font-semibold leading-[0.97] tracking-[-0.04em] text-foreground">
                What market question should we answer?
              </h1>
              <p className="mx-auto max-w-2xl text-pretty text-[1rem] leading-8 text-muted-foreground sm:text-[1.06rem]">
                Ask a complex question. Get a full report, with sources.
              </p>
            </div>

            <div className="w-full max-w-4xl space-y-6" id="dashboard-launcher">
              <DashboardResearchLauncher
                activeWorkspaceId={activeWorkspaceId}
                isSubmitting={launchingResearch}
                onSelectedDocumentIdsChange={setSelectedDocumentIds}
                onSubmit={handleLaunch}
                onWorkspaceChange={setActiveWorkspaceId}
                onWorkspaceRefresh={handleWorkspaceRefresh}
                selectedDocumentIds={selectedDocumentIds}
                workspace={workspace}
                workspaceDocumentCount={workspaceDocumentCount}
                workspaces={workspaces}
              />

              {error ? (
                <div className="mx-auto max-w-3xl rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-left text-sm text-destructive">
                  {error}
                </div>
              ) : null}

              <section className="rounded-[1.75rem] border border-border/60 bg-background/70 px-5 py-5 text-left shadow-[0_10px_30px_rgba(15,23,42,0.035)] sm:px-6 sm:py-6">
                <div className="space-y-5">
                  <div className="space-y-2">
                    <p className="text-[0.68rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Workspace Snapshot
                    </p>
                    <h2 className="text-[1.55rem] font-semibold tracking-tight text-foreground">
                      {workspace?.name ?? "No workspace selected"}
                    </h2>
                    <p className="text-[0.98rem] leading-7 text-muted-foreground">
                      {loadingWorkspace
                        ? "Loading workspace context…"
                        : `${workspace?.uploadedDocumentCount ?? 0} uploaded docs · ${workspace?.generatedReportCount ?? 0} generated reports · ${sessions.length} active sessions`}
                    </p>
                  </div>

                  <div className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <p className="text-[0.68rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Workspace Knowledge
                      </p>
                      <p className="text-[1.05rem] font-semibold tabular-nums text-foreground">
                        {loadingWorkspace ? "…" : workspaceDocumentCount}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-[0.68rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Generated Reports
                      </p>
                      <p className="text-[1.05rem] font-semibold tabular-nums text-foreground">
                        {workspace?.generatedReportCount ?? 0}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-[0.68rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Active Sessions
                      </p>
                      <p className="text-[1.05rem] font-semibold tabular-nums text-foreground">
                        {sessions.length}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/55 pt-4">
                    <Button onClick={handleStartNewSession} type="button">
                      New Session
                    </Button>
                    <Button asChild className="px-0 text-[0.98rem]" variant="link">
                      <Link href="/dashboard/recent">Recent Runs</Link>
                    </Button>
                    <Button asChild className="px-0 text-[0.98rem]" variant="link">
                      <Link href="/dashboard/data-library">Data Library</Link>
                    </Button>
                  </div>

                  <div className="border-t border-border/55 pt-4">
                    {latestSession ? (
                      <Link
                        className="group flex items-start justify-between gap-4 rounded-2xl px-1 py-1 outline-none motion-safe:transition-colors motion-safe:duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                        href={buildSessionThreadHref({
                          runId: latestSession.latestRunId,
                          sessionId: latestSession.id,
                        })}
                      >
                        <div className="min-w-0">
                          <p className="text-[0.68rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                            Latest Session
                          </p>
                          <p className="mt-1 line-clamp-2 text-[1rem] leading-7 text-foreground">
                            {latestSession.title}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 pt-0.5">
                          {latestSession.latestRunStatus ? (
                            <StatusPill status={latestSession.latestRunStatus} />
                          ) : null}
                          <div className="text-muted-foreground/70 transition-colors group-hover:text-foreground">
                            <HomeIcon icon={ArrowRight01Icon} size={16} />
                          </div>
                        </div>
                      </Link>
                    ) : (
                      <div className="text-[0.98rem] leading-7 text-muted-foreground">
                        No sessions yet.
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          </section>

          <section className="mx-auto w-full max-w-4xl space-y-5 pb-8">
            <div className="space-y-2">
              <h2 className="text-[1.22rem] font-semibold tracking-tight text-foreground">
                Suggested Research Plays
              </h2>
              <p className="text-[0.98rem] leading-7 text-muted-foreground">
                Start from a familiar GTM task, then adjust the topic before you
                launch.
              </p>
            </div>

            <div className="divide-y divide-border/60">
              {researchPlays.map((play) => (
                <button
                  key={play.title}
                  className={cn(
                    "group flex w-full items-start gap-4 rounded-2xl px-2 py-4 text-left outline-none motion-safe:transition-colors motion-safe:duration-200 hover:bg-muted/30 focus-visible:bg-muted/30",
                  )}
                  onClick={() => applyResearchPlay(play)}
                  type="button"
                >
                  <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-2xl bg-muted/45 text-foreground/80">
                    <HomeIcon icon={play.icon} size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[1.02rem] font-medium leading-6 text-foreground">
                      {play.title}
                    </p>
                    <p className="mt-1 text-[0.96rem] leading-7 text-muted-foreground">
                      {play.description}
                    </p>
                  </div>
                  <div className="pt-1 text-muted-foreground/70">
                    <HomeIcon icon={ArrowRight01Icon} size={16} />
                  </div>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

export function DashboardHome(props: {
  initialSelectedDocumentIds?: string[]
  initialSessions: SessionSummary[]
  initialTopic?: string
  initialWorkspace: WorkspaceDetail | null
  initialWorkspaces: WorkspaceSummary[]
}) {
  return (
    <PromptInputProvider initialInput={props.initialTopic ?? ""}>
      <DashboardHomeContent {...props} />
    </PromptInputProvider>
  )
}

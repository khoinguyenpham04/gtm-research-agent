"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { startTransition, useEffect, useMemo, useState } from "react"
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

import type { DeepResearchRunSummary } from "@/lib/deep-research/types"
import type { WorkspaceDetail, WorkspaceSummary } from "@/lib/workspaces"
import {
  PromptInputProvider,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input"
import {
  DashboardResearchLauncher,
  type ResearchPlay,
} from "@/app/dashboard/dashboard-research-launcher"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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

function statusVariant(status?: DeepResearchRunSummary["status"]) {
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
  globalDocumentCount,
  initialRecentRuns,
  initialWorkspace,
  initialWorkspaces,
}: {
  globalDocumentCount: number
  initialRecentRuns: DeepResearchRunSummary[]
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
  const [recentRuns, setRecentRuns] = useState(initialRecentRuns)
  const [loadingWorkspace, setLoadingWorkspace] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeWorkspaceId) {
      startTransition(() => {
        setWorkspace(null)
        setRecentRuns([])
      })
      return
    }

    if (workspace?.id === activeWorkspaceId) {
      return
    }

    let cancelled = false

    const loadWorkspaceContext = async () => {
      try {
        setLoadingWorkspace(true)
        setError(null)

        const [workspaceResponse, runsResponse] = await Promise.all([
          fetch(`/api/workspaces/${activeWorkspaceId}`, {
            cache: "no-store",
          }),
          fetch(`/api/deep-research/runs?workspaceId=${activeWorkspaceId}`, {
            cache: "no-store",
          }),
        ])

        const [workspacePayload, runsPayload] = await Promise.all([
          workspaceResponse.json(),
          runsResponse.json(),
        ])

        if (!workspaceResponse.ok) {
          throw new Error(workspacePayload.error || "Failed to load workspace.")
        }

        if (!runsResponse.ok) {
          throw new Error(runsPayload.error || "Failed to load recent runs.")
        }

        if (cancelled) {
          return
        }

        startTransition(() => {
          setWorkspace(workspacePayload)
          setRecentRuns(runsPayload)
        })
      } catch (workspaceError) {
        if (!cancelled) {
          setError(
            workspaceError instanceof Error
              ? workspaceError.message
              : "Failed to load workspace context.",
          )
        }
      } finally {
        if (!cancelled) {
          setLoadingWorkspace(false)
        }
      }
    }

    void loadWorkspaceContext()

    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId, workspace?.id])

  const latestRun = useMemo(() => recentRuns[0] ?? null, [recentRuns])
  const topic = promptController.textInput.value
  const workspaceDocumentCount = workspace?.documents.length ?? 0

  const handleLaunch = (submittedTopic?: string) => {
    const nextTopic = (submittedTopic ?? topic).trim()
    if (!nextTopic) {
      return
    }

    const searchParams = new URLSearchParams()
    searchParams.set("topic", nextTopic)

    if (activeWorkspaceId) {
      searchParams.set("workspaceId", activeWorkspaceId)
    }

    startTransition(() => {
      router.push(`/dashboard/deepresearch?${searchParams.toString()}`)
    })
  }

  const applyResearchPlay = (play: ResearchPlay) => {
    promptController.textInput.setInput(play.topic)
  }

  return (
    <div className="flex flex-1 flex-col py-2 lg:py-4">
      <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col gap-12 px-1 sm:px-2">
        <section className="mx-auto flex w-full max-w-4xl flex-col items-center gap-4 pt-8 text-center lg:pt-14">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted/35 text-foreground/80">
            <HomeIcon
              icon={Telescope01Icon}
              className="text-foreground/80"
              size={24}
            />
          </div>

          <div className="max-w-3xl space-y-3">
            <h1 className="text-balance text-5xl font-semibold leading-[0.97] tracking-[-0.04em] text-foreground">
              What market question should we answer?
            </h1>
            <p className="mx-auto max-w-2xl text-pretty text-[1rem] leading-8 text-muted-foreground sm:text-[1.06rem]">
              Ask a complex question. Get a full report, with sources.
            </p>
          </div>

          <div className="w-full max-w-4xl space-y-6">
            <DashboardResearchLauncher
              activeWorkspaceId={activeWorkspaceId}
              onSubmit={handleLaunch}
              onWorkspaceChange={setActiveWorkspaceId}
              workspace={workspace}
              workspaceDocumentCount={workspaceDocumentCount}
              workspaces={initialWorkspaces}
            />

            {error ? (
              <div className="mx-auto max-w-3xl rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-left text-sm text-destructive">
                {error}
              </div>
            ) : null}

            <div className="space-y-6 border-t border-border/60 pt-6 text-left">
              <div className="grid gap-x-8 gap-y-5 sm:grid-cols-4">
                <div className="space-y-1.5">
                  <p className="text-[0.68rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Workspace
                  </p>
                  <p className="truncate text-[1rem] font-medium leading-6 text-foreground">
                    {workspace?.name ?? "No workspace selected"}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <p className="text-[0.68rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Attached docs
                  </p>
                  <p className="text-[1.05rem] font-semibold tabular-nums text-foreground">
                    {loadingWorkspace ? "…" : workspaceDocumentCount}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <p className="text-[0.68rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Saved runs
                  </p>
                  <p className="text-[1.05rem] font-semibold tabular-nums text-foreground">
                    {recentRuns.length}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <p className="text-[0.68rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Global docs
                  </p>
                  <p className="text-[1.05rem] font-semibold tabular-nums text-foreground">
                    {globalDocumentCount}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button asChild>
                  <Link href="/dashboard/deepresearch">Open Deep Research</Link>
                </Button>
                <Button asChild variant="ghost">
                  <Link href="/dashboard/recent">Recent Runs</Link>
                </Button>
                <Button asChild variant="ghost">
                  <Link href="/dashboard/data-library">Data Library</Link>
                </Button>
              </div>

              {latestRun ? (
                <Link
                  className="group flex items-start justify-between gap-4 rounded-2xl bg-muted/25 px-4 py-3 outline-none motion-safe:transition-colors motion-safe:duration-200 hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-ring/40"
                  href="/dashboard/recent"
                >
                  <div className="min-w-0">
                    <p className="text-[0.68rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Latest output
                    </p>
                    <p className="mt-1 line-clamp-2 text-[0.98rem] leading-7 text-foreground">
                      {latestRun.topic}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={statusVariant(latestRun.status)}>
                      {latestRun.status}
                    </Badge>
                    <div className="text-muted-foreground/70">
                      <HomeIcon icon={ArrowRight01Icon} size={16} />
                    </div>
                  </div>
                </Link>
              ) : null}
            </div>
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
  )
}

export function DashboardHome(props: {
  globalDocumentCount: number
  initialRecentRuns: DeepResearchRunSummary[]
  initialWorkspace: WorkspaceDetail | null
  initialWorkspaces: WorkspaceSummary[]
}) {
  return (
    <PromptInputProvider>
      <DashboardHomeContent {...props} />
    </PromptInputProvider>
  )
}

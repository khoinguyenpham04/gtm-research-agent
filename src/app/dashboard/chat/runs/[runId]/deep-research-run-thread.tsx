"use client"

import Link from "next/link"

import { DeepResearchThreadLauncher } from "@/app/dashboard/chat/deep-research-thread-launcher"
import { Button } from "@/components/ui/button"
import { useDeepResearchRun } from "@/components/deep-research/use-deep-research-run"
import {
  DeepResearchThreadShell,
} from "@/components/deep-research/thread-ui"
import type { DeepResearchRunResponse } from "@/lib/deep-research/types"
import type {
  WorkspaceDetail,
  WorkspaceSummary,
} from "@/lib/workspaces"

export function DeepResearchRunThread({
  initialRun,
  initialWorkspace,
  initialWorkspaces,
}: {
  initialRun: DeepResearchRunResponse
  initialWorkspace: WorkspaceDetail | null
  initialWorkspaces: WorkspaceSummary[]
}) {
  const {
    activeRateLimitRetry,
    citedSources,
    clarificationResponse,
    error,
    preResearchPlan,
    resumeRun,
    retryRun,
    run,
    setClarificationResponse,
    submissionAction,
    submitting,
  } = useDeepResearchRun(initialRun)

  return (
    <DeepResearchThreadShell
      actions={
        run?.status === "completed" || run?.status === "failed" || run?.status === "timed_out" ? (
          <>
            <Button asChild>
              <Link href="/dashboard">Start another research</Link>
            </Button>
            <Button asChild variant="outline">
              <Link
                href={
                  run?.workspaceId
                    ? `/dashboard/deepresearch?workspaceId=${run.workspaceId}`
                    : "/dashboard/deepresearch"
                }
              >
                Open fallback console
              </Link>
            </Button>
          </>
        ) : null
      }
      activeRateLimitRetry={activeRateLimitRetry}
      citedSources={citedSources}
      clarificationResponse={clarificationResponse}
      error={error}
      objective={run?.objective}
      onClarificationResponseChange={setClarificationResponse}
      onResume={() => void resumeRun()}
      onRetry={() => void retryRun()}
      preResearchPlan={preResearchPlan}
      run={run}
      selectedDocuments={run?.selectedDocuments ?? []}
      submissionAction={submissionAction}
      submitting={submitting}
      topic={run?.topic ?? initialRun.topic}
      workspaceName={run?.workspace?.name ?? run?.workspaceId}
      composer={
        run?.workspaceId ? (
          <DeepResearchThreadLauncher
            initialSelectedDocumentIds={run.selectedDocuments.map(
              (document) => document.id,
            )}
            initialWorkspace={initialWorkspace}
            initialWorkspaceId={run.workspaceId}
            initialWorkspaces={initialWorkspaces}
          />
        ) : null
      }
    />
  )
}

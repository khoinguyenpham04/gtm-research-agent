import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import { SiteHeader } from "@/components/site-header"
import { ensureDeepResearchDatabase } from "@/lib/deep-research/db"
import {
  getDeepResearchRun,
  listDeepResearchRuns,
} from "@/lib/deep-research/service"
import { listWorkspaces } from "@/lib/workspaces"
import { RecentRunsConsole } from "@/app/dashboard/recent/recent-runs-console"

function readSearchParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0]
  }

  return value
}

export default async function RecentRunsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const { userId } = await auth()
  if (!userId) {
    redirect("/sign-in")
  }

  await ensureDeepResearchDatabase().catch(() => undefined)
  const resolvedSearchParams = (await searchParams) ?? {}

  const initialWorkspaces = await listWorkspaces(userId).catch(() => [])
  const requestedWorkspaceId =
    readSearchParam(resolvedSearchParams.workspaceId)?.trim() ?? ""
  const requestedRunId = readSearchParam(resolvedSearchParams.runId)?.trim() ?? ""
  const requestedRun = requestedRunId
    ? await getDeepResearchRun(requestedRunId, userId).catch(() => null)
    : null
  const initialWorkspaceId =
    initialWorkspaces.find((workspace) => workspace.id === requestedWorkspaceId)
      ?.id ??
    requestedRun?.workspaceId ??
    initialWorkspaces[0]?.id ??
    ""
  const initialRecentRuns = await listDeepResearchRuns({
    workspaceId: initialWorkspaceId || undefined,
    limit: 20,
    clerkUserId: userId,
  }).catch(() => [])
  const initialRun =
    requestedRun && requestedRun.workspaceId === initialWorkspaceId
      ? requestedRun
      : initialRecentRuns[0]
        ? await getDeepResearchRun(initialRecentRuns[0].id, userId).catch(() => null)
        : null

  return (
    <>
      <SiteHeader
        title="Recent Runs"
        description="Browse saved deep-research runs by workspace and reopen the details you need."
      />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2 px-4 py-4 lg:px-6 lg:py-6">
          <RecentRunsConsole
            initialRecentRuns={initialRecentRuns}
            initialRun={initialRun}
            initialWorkspaceId={initialWorkspaceId}
            initialWorkspaces={initialWorkspaces}
          />
        </div>
      </div>
    </>
  )
}

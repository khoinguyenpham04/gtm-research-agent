import { SiteHeader } from "@/components/site-header"
import { ensureDeepResearchDatabase } from "@/lib/deep-research/db"
import {
  getDeepResearchRun,
  listDeepResearchRuns,
} from "@/lib/deep-research/service"
import { listWorkspaces } from "@/lib/workspaces"
import { RecentRunsConsole } from "@/app/dashboard/recent/recent-runs-console"

export default async function RecentRunsPage() {
  await ensureDeepResearchDatabase().catch(() => undefined)

  const initialWorkspaces = await listWorkspaces().catch(() => [])
  const initialWorkspaceId = initialWorkspaces[0]?.id ?? ""
  const initialRecentRuns = await listDeepResearchRuns({
    workspaceId: initialWorkspaceId || undefined,
    limit: 20,
  }).catch(() => [])
  const initialRun = initialRecentRuns[0]
    ? await getDeepResearchRun(initialRecentRuns[0].id).catch(() => null)
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

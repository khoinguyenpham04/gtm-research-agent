import { SiteHeader } from "@/components/site-header"
import { DashboardHome } from "@/app/dashboard/dashboard-home"
import { listDocuments } from "@/lib/documents"
import { ensureDeepResearchDatabase } from "@/lib/deep-research/db"
import { listDeepResearchRuns } from "@/lib/deep-research/service"
import { getWorkspaceDetail, listWorkspaces } from "@/lib/workspaces"

export default async function DashboardPage() {
  await ensureDeepResearchDatabase().catch(() => undefined)

  const [initialWorkspaces, globalDocumentCount] = await Promise.all([
    listWorkspaces().catch(() => []),
    listDocuments()
      .then((documents) => documents.length)
      .catch(() => 0),
  ])

  const initialWorkspaceId = initialWorkspaces[0]?.id ?? ""
  const [initialWorkspace, initialRecentRuns] = await Promise.all([
    initialWorkspaceId
      ? getWorkspaceDetail(initialWorkspaceId).catch(() => null)
      : Promise.resolve(null),
    listDeepResearchRuns({
      workspaceId: initialWorkspaceId || undefined,
      limit: 20,
    }).catch(() => []),
  ])

  return (
    <>
      <SiteHeader
        title="Home"
      />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col px-4 py-4 lg:px-6 lg:py-6">
          <DashboardHome
            globalDocumentCount={globalDocumentCount}
            initialRecentRuns={initialRecentRuns}
            initialWorkspace={initialWorkspace}
            initialWorkspaces={initialWorkspaces}
          />
        </div>
      </div>
    </>
  )
}

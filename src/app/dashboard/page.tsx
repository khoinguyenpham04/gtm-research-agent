import { SiteHeader } from "@/components/site-header"
import { DashboardHome } from "@/app/dashboard/dashboard-home"
import { ensureDeepResearchDatabase } from "@/lib/deep-research/db"
import { listSessions } from "@/lib/deep-research/service"
import { getWorkspaceDetail, listWorkspaces } from "@/lib/workspaces"

export default async function DashboardPage() {
  await ensureDeepResearchDatabase().catch(() => undefined)

  const initialWorkspaces = await listWorkspaces().catch(() => [])

  const initialWorkspaceId = initialWorkspaces[0]?.id ?? ""
  const [initialWorkspace, initialSessions] = await Promise.all([
    initialWorkspaceId
      ? getWorkspaceDetail(initialWorkspaceId).catch(() => null)
      : Promise.resolve(null),
    initialWorkspaceId
      ? listSessions({
          workspaceId: initialWorkspaceId,
          limit: 24,
        }).catch(() => [])
      : Promise.resolve([]),
  ])

  return (
    <>
      <SiteHeader
        title="Home"
      />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col px-4 py-4 lg:px-6 lg:py-6">
          <DashboardHome
            initialSessions={initialSessions}
            initialWorkspace={initialWorkspace}
            initialWorkspaces={initialWorkspaces}
          />
        </div>
      </div>
    </>
  )
}

import { SiteHeader } from "@/components/site-header"
import { listDocuments } from "@/lib/documents"
import { ensureDeepResearchDatabase } from "@/lib/deep-research/db"
import { getWorkspaceDetail, listWorkspaces } from "@/lib/workspaces"
import { DeepResearchConsole } from "@/app/dashboard/research-console"

export default async function Page() {
  await ensureDeepResearchDatabase().catch(() => undefined)
  const [initialDocuments, initialWorkspaces] = await Promise.all([
    listDocuments().catch(() => []),
    listWorkspaces().catch(() => []),
  ])
  const initialWorkspace =
    initialWorkspaces[0]
      ? await getWorkspaceDetail(initialWorkspaces[0].id).catch(() => null)
      : null

  return (
    <>
      <SiteHeader
        title="Deep Research"
        description="Run workspace-scoped deep research without managing the full file tree here."
      />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2 px-4 py-4 lg:px-6 lg:py-6">
          <DeepResearchConsole
            initialDocuments={initialDocuments}
            initialWorkspace={initialWorkspace}
            initialWorkspaces={initialWorkspaces}
          />
        </div>
      </div>
    </>
  )
}

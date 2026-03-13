import { SiteHeader } from "@/components/site-header"
import { listDocuments } from "@/lib/documents"
import { ensureDeepResearchDatabase } from "@/lib/deep-research/db"
import { getWorkspaceDetail, listWorkspaces } from "@/lib/workspaces"

import { DataLibraryConsole } from "@/app/dashboard/data-library-console"

export default async function DataLibraryPage() {
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
        title="Data Library"
        description="Manage the canonical global library and the workspace-specific knowledge attached to each research environment."
      />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2 px-4 py-4 lg:px-6 lg:py-6">
          <DataLibraryConsole
            initialDocuments={initialDocuments}
            initialWorkspace={initialWorkspace}
            initialWorkspaces={initialWorkspaces}
          />
        </div>
      </div>
    </>
  )
}

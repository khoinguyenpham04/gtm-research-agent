import { SiteHeader } from "@/components/site-header"
import { DeepResearchConsole } from "@/app/dashboard/research-console"
import { listDocuments } from "@/lib/documents"
import { ensureDeepResearchDatabase } from "@/lib/deep-research/db"
import { getWorkspaceDetail, listWorkspaces } from "@/lib/workspaces"

function readSearchParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0]
  }

  return value
}

export default async function DeepResearchPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  await ensureDeepResearchDatabase().catch(() => undefined)
  const resolvedSearchParams = (await searchParams) ?? {}
  const [initialDocuments, initialWorkspaces] = await Promise.all([
    listDocuments().catch(() => []),
    listWorkspaces().catch(() => []),
  ])
  const requestedWorkspaceId =
    readSearchParam(resolvedSearchParams.workspaceId)?.trim() ?? ""
  const initialWorkspaceId =
    initialWorkspaces.find((workspace) => workspace.id === requestedWorkspaceId)
      ?.id ??
    initialWorkspaces[0]?.id ??
    ""
  const initialWorkspace = initialWorkspaceId
    ? await getWorkspaceDetail(initialWorkspaceId).catch(() => null)
    : null
  const initialTopic = readSearchParam(resolvedSearchParams.topic)?.trim() ?? ""
  const initialObjective =
    readSearchParam(resolvedSearchParams.objective)?.trim() ?? ""

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
            initialObjective={initialObjective}
            initialTopic={initialTopic}
            initialWorkspace={initialWorkspace}
            initialWorkspaceId={initialWorkspaceId}
            initialWorkspaces={initialWorkspaces}
          />
        </div>
      </div>
    </>
  )
}

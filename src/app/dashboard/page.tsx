import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import { SiteHeader } from "@/components/site-header"
import { DashboardHome } from "@/app/dashboard/dashboard-home"
import { ensureDeepResearchDatabase } from "@/lib/deep-research/db"
import { listSessions } from "@/lib/deep-research/service"
import { getWorkspaceDetail, listWorkspaces } from "@/lib/workspaces"

function readSearchParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0]
  }

  return value
}

export default async function DashboardPage({
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
  const initialTopic = readSearchParam(resolvedSearchParams.topic)?.trim() ?? ""
  const initialSelectedDocumentIds = (
    readSearchParam(resolvedSearchParams.selectedDocumentIds)?.trim() ?? ""
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)

  const initialWorkspaceId =
    initialWorkspaces.find((workspace) => workspace.id === requestedWorkspaceId)
      ?.id ??
    initialWorkspaces[0]?.id ??
    ""
  const [initialWorkspace, initialSessions] = await Promise.all([
    initialWorkspaceId
      ? getWorkspaceDetail(initialWorkspaceId, userId).catch(() => null)
      : Promise.resolve(null),
    initialWorkspaceId
      ? listSessions({
          workspaceId: initialWorkspaceId,
          limit: 24,
          clerkUserId: userId,
        }).catch(() => [])
      : Promise.resolve([]),
  ])
  const filteredSelectedDocumentIds =
    initialSelectedDocumentIds.length > 0 && initialWorkspace
      ? initialSelectedDocumentIds.filter((documentId) =>
          initialWorkspace.documents.some(
            (attachment) => attachment.documentId === documentId,
          ),
        )
      : []

  return (
    <>
      <SiteHeader
        title="Home"
      />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col px-4 py-4 lg:px-6 lg:py-6">
          <DashboardHome
            initialSelectedDocumentIds={filteredSelectedDocumentIds}
            initialSessions={initialSessions}
            initialTopic={initialTopic}
            initialWorkspace={initialWorkspace}
            initialWorkspaces={initialWorkspaces}
          />
        </div>
      </div>
    </>
  )
}

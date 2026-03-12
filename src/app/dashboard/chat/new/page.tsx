import { redirect } from "next/navigation"

import { DeepResearchChatLauncher } from "@/app/dashboard/chat/new/deep-research-chat-launcher"
import { SiteHeader } from "@/components/site-header"
import { ensureDeepResearchDatabase } from "@/lib/deep-research/db"
import { getWorkspaceDetail, listWorkspaces } from "@/lib/workspaces"

function readSearchParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0]
  }

  return value
}

function buildSearchParams(
  values: Record<string, string | string[] | undefined>,
  overrides: Record<string, string>,
) {
  const searchParams = new URLSearchParams()

  for (const [key, rawValue] of Object.entries(values)) {
    if (Array.isArray(rawValue)) {
      if (rawValue[0]) {
        searchParams.set(key, rawValue[0])
      }
      continue
    }

    if (rawValue) {
      searchParams.set(key, rawValue)
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    searchParams.set(key, value)
  }

  return searchParams
}

export default async function DeepResearchNewChatPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  await ensureDeepResearchDatabase().catch(() => undefined)

  const resolvedSearchParams = (await searchParams) ?? {}
  const launchKey = readSearchParam(resolvedSearchParams.launchKey)?.trim() ?? ""

  if (!launchKey) {
    const nextSearchParams = buildSearchParams(resolvedSearchParams, {
      launchKey: crypto.randomUUID(),
    })

    redirect(`/dashboard/chat/new?${nextSearchParams.toString()}`)
  }

  const topic = readSearchParam(resolvedSearchParams.topic)?.trim() ?? ""
  const objective = readSearchParam(resolvedSearchParams.objective)?.trim() ?? ""
  const workspaceId =
    readSearchParam(resolvedSearchParams.workspaceId)?.trim() ?? ""
  const selectedDocumentIds = (
    readSearchParam(resolvedSearchParams.selectedDocumentIds)?.trim() ?? ""
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)

  const [initialWorkspace, initialWorkspaces] = await Promise.all([
    workspaceId ? getWorkspaceDetail(workspaceId).catch(() => null) : Promise.resolve(null),
    listWorkspaces().catch(() => []),
  ])
  const selectedDocuments =
    initialWorkspace?.documents
      .filter((attachment) => selectedDocumentIds.includes(attachment.documentId))
      .map((attachment) => attachment.document) ?? []
  const fallbackHref = workspaceId
    ? `/dashboard/deepresearch?workspaceId=${workspaceId}`
    : "/dashboard/deepresearch"

  return (
    <>
      <SiteHeader
        title="Deep Research"
        description="A dedicated thread for this workspace-scoped research launch."
      />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col px-4 py-4 lg:px-6 lg:py-6">
          <DeepResearchChatLauncher
            fallbackHref={fallbackHref}
            launchKey={launchKey}
          objective={objective || undefined}
          initialWorkspace={initialWorkspace}
          initialWorkspaces={initialWorkspaces}
          selectedDocumentIds={selectedDocumentIds}
          selectedDocuments={selectedDocuments}
          topic={topic}
            workspaceId={workspaceId}
            workspaceName={initialWorkspace?.name}
          />
        </div>
      </div>
    </>
  )
}

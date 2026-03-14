import { redirect } from "next/navigation"

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
  const resolvedSearchParams = (await searchParams) ?? {}
  const nextSearchParams = new URLSearchParams()

  nextSearchParams.set("mode", "research")

  const topic = readSearchParam(resolvedSearchParams.topic)?.trim()
  const objective = readSearchParam(resolvedSearchParams.objective)?.trim()
  const workspaceId = readSearchParam(resolvedSearchParams.workspaceId)?.trim()
  const selectedDocumentIds = readSearchParam(
    resolvedSearchParams.selectedDocumentIds,
  )?.trim()

  if (workspaceId) {
    nextSearchParams.set("workspaceId", workspaceId)
  }

  if (topic) {
    nextSearchParams.set("topic", topic)
  }

  if (objective) {
    nextSearchParams.set("objective", objective)
  }

  if (selectedDocumentIds) {
    nextSearchParams.set("selectedDocumentIds", selectedDocumentIds)
  }

  redirect(`/dashboard?${nextSearchParams.toString()}`)
}

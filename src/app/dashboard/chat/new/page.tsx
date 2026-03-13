import { redirect } from "next/navigation"

function readSearchParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0]
  }

  return value
}

export default async function DeepResearchNewChatPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const resolvedSearchParams = (await searchParams) ?? {}
  const nextSearchParams = new URLSearchParams()

  const topic = readSearchParam(resolvedSearchParams.topic)?.trim()
  if (topic) {
    nextSearchParams.set("topic", topic)
  }

  const workspaceId = readSearchParam(resolvedSearchParams.workspaceId)?.trim()
  if (workspaceId) {
    nextSearchParams.set("workspaceId", workspaceId)
  }

  const selectedDocumentIds =
    readSearchParam(resolvedSearchParams.selectedDocumentIds)?.trim()
  if (selectedDocumentIds) {
    nextSearchParams.set("selectedDocumentIds", selectedDocumentIds)
  }

  redirect(
    nextSearchParams.size
      ? `/dashboard?${nextSearchParams.toString()}`
      : "/dashboard",
  )
}

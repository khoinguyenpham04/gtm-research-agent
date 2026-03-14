import { redirect } from "next/navigation"

import { ensureDeepResearchDatabase } from "@/lib/deep-research/db"
import { getDeepResearchRun } from "@/lib/deep-research/service"
import { buildSessionThreadHref } from "@/components/deep-research/utils"
import { auth } from "@clerk/nextjs/server"

function readSearchParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0]
  }

  return value
}

export default async function RecentRunsPage({
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
  const requestedRunId = readSearchParam(resolvedSearchParams.runId)?.trim() ?? ""
  const requestedWorkspaceId =
    readSearchParam(resolvedSearchParams.workspaceId)?.trim() ?? ""
  const requestedRun = requestedRunId
    ? await getDeepResearchRun(requestedRunId, userId).catch(() => null)
    : null

  if (requestedRun?.sessionId) {
    redirect(
      buildSessionThreadHref({
        mode: "research",
        runId: requestedRun.id,
        sessionId: requestedRun.sessionId,
      }),
    )
  }

  const nextSearchParams = new URLSearchParams({
    mode: "research",
  })

  const workspaceId = requestedRun?.workspaceId ?? requestedWorkspaceId
  if (workspaceId) {
    nextSearchParams.set("workspaceId", workspaceId)
  }

  if (requestedRun?.topic) {
    nextSearchParams.set("topic", requestedRun.topic)
  }

  if (requestedRun?.selectedDocuments?.length) {
    nextSearchParams.set(
      "selectedDocumentIds",
      requestedRun.selectedDocuments.map((document) => document.id).join(","),
    )
  }

  redirect(`/dashboard?${nextSearchParams.toString()}`)
}

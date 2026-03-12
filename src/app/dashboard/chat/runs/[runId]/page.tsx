import Link from "next/link"

import { DeepResearchRunThread } from "@/app/dashboard/chat/runs/[runId]/deep-research-run-thread"
import { SiteHeader } from "@/components/site-header"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ensureDeepResearchDatabase } from "@/lib/deep-research/db"
import { getDeepResearchRun } from "@/lib/deep-research/service"
import { getWorkspaceDetail, listWorkspaces } from "@/lib/workspaces"

export default async function DeepResearchRunThreadPage({
  params,
}: {
  params: Promise<{ runId: string }>
}) {
  await ensureDeepResearchDatabase().catch(() => undefined)

  const { runId } = await params
  const initialRun = await getDeepResearchRun(runId).catch(() => null)
  const [initialWorkspace, initialWorkspaces] = initialRun?.workspaceId
    ? await Promise.all([
        getWorkspaceDetail(initialRun.workspaceId).catch(() => null),
        listWorkspaces().catch(() => []),
      ])
    : [null, await listWorkspaces().catch(() => [])]

  return (
    <>
      <SiteHeader
        title="Deep Research"
        description="A dedicated thread for one deep research execution."
      />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col px-4 py-4 lg:px-6 lg:py-6">
          {initialRun ? (
            <DeepResearchRunThread
              initialRun={initialRun}
              initialWorkspace={initialWorkspace}
              initialWorkspaces={initialWorkspaces}
            />
          ) : (
            <Card className="mx-auto w-full max-w-2xl border border-border/60">
              <CardHeader>
                <CardTitle>Research thread not found</CardTitle>
                <CardDescription>
                  This run may have been removed, or the link may be invalid.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Button asChild>
                  <Link href="/dashboard">Back to dashboard</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/dashboard/recent">Open recent runs</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}

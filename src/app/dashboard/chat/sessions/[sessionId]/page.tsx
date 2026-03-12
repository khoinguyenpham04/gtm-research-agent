import Link from "next/link"

import { DeepResearchSessionThread } from "@/app/dashboard/chat/sessions/[sessionId]/session-thread"
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
import { getSessionThread } from "@/lib/deep-research/service"
import { getWorkspaceDetail, listWorkspaces } from "@/lib/workspaces"

export default async function SessionThreadPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  await ensureDeepResearchDatabase().catch(() => undefined)

  const { sessionId } = await params
  const initialThread = await getSessionThread(sessionId).catch(() => null)

  const [initialWorkspace, initialWorkspaces] = initialThread
    ? await Promise.all([
        getWorkspaceDetail(initialThread.session.workspaceId).catch(() => null),
        listWorkspaces().catch(() => []),
      ])
    : [null, await listWorkspaces().catch(() => [])]

  return (
    <>
      <SiteHeader
        title="Session"
        description="A durable workspace-scoped research thread."
      />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col px-4 py-4 lg:px-6 lg:py-6">
          {initialThread ? (
            <DeepResearchSessionThread
              initialThread={initialThread}
              initialWorkspace={initialWorkspace}
              initialWorkspaces={initialWorkspaces}
            />
          ) : (
            <Card className="mx-auto w-full max-w-2xl border border-border/60">
              <CardHeader>
                <CardTitle>Session not found</CardTitle>
                <CardDescription>
                  This session may have been removed, or the link may be invalid.
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

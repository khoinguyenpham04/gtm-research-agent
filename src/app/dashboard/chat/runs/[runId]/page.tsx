import Link from "next/link"
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import { buildSessionThreadHref } from "@/components/deep-research/utils"
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

export default async function DeepResearchRunThreadPage({
  params,
}: {
  params: Promise<{ runId: string }>
}) {
  const { userId } = await auth()
  if (!userId) {
    redirect("/sign-in")
  }

  await ensureDeepResearchDatabase().catch(() => undefined)

  const { runId } = await params
  const run = await getDeepResearchRun(runId, userId).catch(() => null)

  if (run?.sessionId) {
    redirect(
      buildSessionThreadHref({
        mode: "research",
        runId,
        sessionId: run.sessionId,
      }),
    )
  }

  if (run) {
    const nextSearchParams = new URLSearchParams({ mode: "research" })
    if (run.workspaceId) {
      nextSearchParams.set("workspaceId", run.workspaceId)
    }
    if (run.topic) {
      nextSearchParams.set("topic", run.topic)
    }
    if (run.selectedDocuments.length > 0) {
      nextSearchParams.set(
        "selectedDocumentIds",
        run.selectedDocuments.map((document) => document.id).join(","),
      )
    }

    redirect(`/dashboard?${nextSearchParams.toString()}`)
  }

  return (
    <>
      <SiteHeader title="Deep Research" />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col px-4 pt-4 lg:px-6 lg:pt-6">
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
          </CardContent>
        </Card>
      </div>
      </div>
    </>
  )
}

import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import { SiteHeader } from "@/components/site-header"

import { RagSearchConsole } from "@/app/dashboard/rag-search-console"

export default async function RagSearchPage() {
  const { userId } = await auth()
  if (!userId) {
    redirect("/sign-in")
  }

  return (
    <>
      <SiteHeader
        title="RAG Search"
        description="Search your uploaded document corpus from the same dashboard shell as deep research and the data library."
      />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2 px-4 py-4 lg:px-6 lg:py-6">
          <RagSearchConsole />
        </div>
      </div>
    </>
  )
}

import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { listDocuments } from "@/lib/documents"
import { DeepResearchConsole } from "@/app/dashboard/research-console"

export default async function Page() {
  const initialDocuments = await listDocuments().catch(() => [])

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader
          title="Deep Research"
          description="Run a server-side LangGraph deep research workflow over selected uploads and Tavily."
        />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2 px-4 py-4 lg:px-6 lg:py-6">
            <DeepResearchConsole initialDocuments={initialDocuments} />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

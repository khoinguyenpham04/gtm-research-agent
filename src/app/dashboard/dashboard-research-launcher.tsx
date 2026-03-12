"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowRight01Icon,
  DashboardSquare02Icon,
  File01Icon,
  FolderLibraryIcon,
  Telescope01Icon,
} from "@hugeicons/core-free-icons"
import { CheckIcon, ChevronDownIcon } from "lucide-react"

import type { WorkspaceDetail, WorkspaceSummary } from "@/lib/workspaces"
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputCommand,
  PromptInputCommandEmpty,
  PromptInputCommandGroup,
  PromptInputCommandInput,
  PromptInputCommandItem,
  PromptInputCommandList,
  PromptInputCommandSeparator,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
export type ResearchPlay = {
  title: string
  description: string
  topic: string
  icon: unknown
}

function LauncherIcon({
  icon,
  className,
  size = 16,
}: {
  icon: unknown
  className?: string
  size?: number
}) {
  return (
    <HugeiconsIcon
      aria-hidden="true"
      className={className}
      color="currentColor"
      icon={icon as never}
      size={size}
      strokeWidth={1.8}
    />
  )
}

export function DashboardResearchLauncher({
  activeWorkspaceId,
  workspace,
  workspaceDocumentCount,
  workspaces,
  onSubmit,
  onWorkspaceChange,
}: {
  activeWorkspaceId: string
  workspace: WorkspaceDetail | null
  workspaceDocumentCount: number
  workspaces: WorkspaceSummary[]
  onSubmit: (text?: string) => void
  onWorkspaceChange: (workspaceId: string) => void
}) {
  const promptController = usePromptInputController()
  const topic = promptController.textInput.value

  return (
    <PromptInput
      className="w-full rounded-[1.9rem] bg-background shadow-[0_12px_36px_rgba(15,23,42,0.06)] [&_[data-slot=input-group]]:rounded-[1.9rem]"
      onSubmit={({ text }) => {
        onSubmit(text)
      }}
    >
      <PromptInputBody>
        <PromptInputTextarea
          aria-label="Research topic"
          className="min-h-24 px-5 pt-5 text-base leading-7 placeholder:text-[0.98rem] placeholder:text-muted-foreground/72 sm:min-h-32 sm:px-6 sm:text-[1.05rem]"
          placeholder="Ask for a market entry brief, competitive scan, ICP analysis, pricing review, or regulatory scan…"
        />
      </PromptInputBody>

      <PromptInputFooter className="flex-col items-stretch gap-3 pt-3 sm:flex-row sm:items-center">
        <PromptInputTools className="w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="inline-flex h-11 items-center gap-2 rounded-full bg-[#EAF1FF] px-4 text-sm font-medium text-[#246BFF]">
            <LauncherIcon icon={Telescope01Icon} size={18} />
            <span>Deep Research</span>
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <PromptInputButton
                aria-label="Open workspace context"
                className="h-9 max-w-full rounded-full border border-border/55 bg-background px-3 text-sm"
                variant="outline"
              >
                <LauncherIcon
                  className="text-muted-foreground"
                  icon={DashboardSquare02Icon}
                  size={14}
                />
                <span>Workspace</span>
                <ChevronDownIcon className="size-4 text-muted-foreground" />
              </PromptInputButton>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-[min(27rem,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-border/60 bg-background p-0 shadow-[0_16px_40px_rgba(15,23,42,0.12)]"
              sideOffset={10}
            >
              <PromptInputCommand className="bg-transparent">
                <PromptInputCommandInput
                  className="border-b border-border/55 px-1 text-sm"
                  placeholder="Switch workspace…"
                />
                <PromptInputCommandList className="max-h-[26rem]">
                  <PromptInputCommandEmpty className="py-6 text-sm text-muted-foreground">
                    No workspaces found.
                  </PromptInputCommandEmpty>
                  <PromptInputCommandGroup heading="Workspaces">
                    {workspaces.map((item) => {
                      const isActive = item.id === activeWorkspaceId
                      return (
                        <PromptInputCommandItem
                          className="gap-3 px-3 py-3"
                          key={item.id}
                          onSelect={() => onWorkspaceChange(item.id)}
                          value={`${item.name} ${item.description ?? ""}`}
                        >
                          <LauncherIcon
                            className="text-muted-foreground"
                            icon={DashboardSquare02Icon}
                            size={16}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-foreground">
                              {item.name}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {item.documentCount} docs
                            </div>
                          </div>
                          <div className="shrink-0 text-muted-foreground">
                            {isActive ? <CheckIcon className="size-4" /> : null}
                          </div>
                        </PromptInputCommandItem>
                      )
                    })}
                  </PromptInputCommandGroup>

                  <PromptInputCommandSeparator />

                  <PromptInputCommandGroup heading="Attached Documents">
                    {workspace?.documents.length ? (
                      workspace.documents.slice(0, 6).map((document) => (
                        <PromptInputCommandItem
                          className="gap-3 px-3 py-3"
                          key={document.documentId}
                          value={document.document.file_name}
                        >
                          <LauncherIcon
                            className="text-muted-foreground"
                            icon={File01Icon}
                            size={16}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm text-foreground">
                              {document.document.file_name}
                            </div>
                          </div>
                        </PromptInputCommandItem>
                      ))
                    ) : (
                      <div className="px-3 py-3 text-sm text-muted-foreground">
                        No documents are attached to this workspace yet.
                      </div>
                    )}
                  </PromptInputCommandGroup>
                </PromptInputCommandList>
              </PromptInputCommand>

              {workspace?.documents.length && workspace.documents.length > 6 ? (
                <div className="border-t px-3 py-2 text-xs text-muted-foreground">
                  Showing 6 of {workspace.documents.length} attached documents.
                </div>
              ) : null}
            </PopoverContent>
          </Popover>

          <div className="order-last flex min-w-0 w-full items-center gap-2 px-1 pt-0.5 text-[0.82rem] text-muted-foreground sm:order-none sm:flex-1 sm:justify-end sm:pt-0">
            <LauncherIcon icon={FolderLibraryIcon} size={14} />
            <span className="min-w-0 truncate">
              {(workspace?.name ?? "No workspace").trim()} · {workspaceDocumentCount || 0} docs + web
            </span>
          </div>
        </PromptInputTools>

        <PromptInputSubmit
          aria-disabled={topic.trim().length === 0}
          className="ml-auto size-10 rounded-full bg-foreground text-background hover:bg-foreground/90 sm:ml-0"
        >
          <LauncherIcon icon={ArrowRight01Icon} size={18} />
        </PromptInputSubmit>
      </PromptInputFooter>
    </PromptInput>
  )
}

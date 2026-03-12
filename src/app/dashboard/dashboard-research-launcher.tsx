"use client"

import { useMemo, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowRight01Icon,
  DashboardSquare02Icon,
  File01Icon,
  FolderLibraryIcon,
  Upload04Icon,
  Telescope01Icon,
} from "@hugeicons/core-free-icons"
import { CheckIcon, ChevronDownIcon, PlusIcon } from "lucide-react"

import type { WorkspaceDetail, WorkspaceSummary } from "@/lib/workspaces"
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@/components/ai-elements/attachments"
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
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

type LauncherUploadState = "idle" | "uploading" | "success" | "error"

type LauncherUploadFailure = {
  fileName: string
  reason: string
}

type LauncherUploadResult = {
  uploaded: string[]
  failed: LauncherUploadFailure[]
}

const ACCEPTED_DOCUMENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
].join(",")

export function DashboardResearchLauncher({
  activeWorkspaceId,
  workspace,
  workspaceDocumentCount,
  workspaces,
  onWorkspaceRefresh,
  selectedDocumentIds,
  onSelectedDocumentIdsChange,
  onSubmit,
  onWorkspaceChange,
}: {
  activeWorkspaceId: string
  workspace: WorkspaceDetail | null
  workspaceDocumentCount: number
  workspaces: WorkspaceSummary[]
  onWorkspaceRefresh: (workspaceId: string) => Promise<void>
  selectedDocumentIds: string[]
  onSelectedDocumentIdsChange: (documentIds: string[]) => void
  onSubmit: (text?: string) => void
  onWorkspaceChange: (workspaceId: string) => void
}) {
  const promptController = usePromptInputController()
  const attachments = usePromptInputAttachments()
  const topic = promptController.textInput.value
  const [workspacePopoverOpen, setWorkspacePopoverOpen] = useState(false)
  const [showMoreWorkspaces, setShowMoreWorkspaces] = useState(false)
  const [workspaceDraftName, setWorkspaceDraftName] = useState("")
  const [creatingWorkspace, setCreatingWorkspace] = useState(false)
  const [uploadState, setUploadState] = useState<LauncherUploadState>("idle")
  const [uploadResult, setUploadResult] = useState<LauncherUploadResult | null>(
    null,
  )
  const [uploadError, setUploadError] = useState<string | null>(null)
  const pendingUploads = attachments.files
  const hasPendingUploads = pendingUploads.length > 0
  const submitDisabled =
    topic.trim().length === 0 || hasPendingUploads || uploadState === "uploading"
  const attachedDocuments = workspace?.documents ?? []
  const selectedDocumentIdSet = useMemo(
    () => new Set(selectedDocumentIds),
    [selectedDocumentIds],
  )
  const visibleWorkspaces = workspaces.slice(0, 4)
  const overflowWorkspaces = workspaces.slice(4)
  const selectedDocLabel =
    workspaceDocumentCount > 0
      ? `${selectedDocumentIds.length} of ${workspaceDocumentCount} docs + web`
      : "0 docs + web"

  const workspaceSummary = useMemo(() => {
    const name = (workspace?.name ?? "No workspace").trim()
    const countLabel = selectedDocLabel
    return `${name} · ${countLabel}`
  }, [selectedDocLabel, workspace?.name])

  const filePartToFile = async (filePart: (typeof pendingUploads)[number]) => {
    const response = await fetch(filePart.url)
    if (!response.ok) {
      throw new Error(`Failed to read ${filePart.filename}.`)
    }

    const blob = await response.blob()

    return new File([blob], filePart.filename || "upload", {
      type: filePart.mediaType || blob.type || "application/octet-stream",
    })
  }

  const uploadPendingDocuments = async () => {
    if (uploadState === "uploading") {
      return
    }

    if (!activeWorkspaceId) {
      setUploadState("error")
      setUploadResult(null)
      setUploadError("Select a workspace before uploading documents.")
      return
    }

    if (!hasPendingUploads) {
      setUploadState("idle")
      setUploadResult(null)
      setUploadError(null)
      attachments.openFileDialog()
      return
    }

    setUploadState("uploading")
    setUploadResult(null)
    setUploadError(null)

    const uploaded: string[] = []
    const failed: LauncherUploadFailure[] = []

    for (const attachment of [...pendingUploads]) {
      try {
        const file = await filePartToFile(attachment)
        const formData = new FormData()
        formData.append("file", file)
        formData.append("workspaceId", activeWorkspaceId)

        const response = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        })

        const payload = await response.json()

        if (!response.ok || payload.success === false) {
          throw new Error(payload.error || `Failed to upload ${file.name}.`)
        }

        uploaded.push(file.name)
        attachments.remove(attachment.id)
      } catch (error) {
        failed.push({
          fileName: attachment.filename || "Unnamed file",
          reason:
            error instanceof Error ? error.message : "Failed to upload file.",
        })
      }
    }

    if (uploaded.length > 0) {
      try {
        await onWorkspaceRefresh(activeWorkspaceId)
      } catch (error) {
        failed.push({
          fileName: "Workspace refresh",
          reason:
            error instanceof Error
              ? error.message
              : "Uploaded files, but failed to refresh workspace context.",
        })
      }
    }

    setUploadResult({ uploaded, failed })

    if (uploaded.length > 0) {
      setUploadState(failed.length > 0 ? "error" : "success")
      setUploadError(
        failed.length > 0
          ? "Some documents were uploaded, but a few still need attention."
          : null,
      )
      return
    }

    setUploadState("error")
    setUploadError(
      failed[0]?.reason || "No documents were uploaded. Please try again.",
    )
  }

  const handleCreateWorkspace = async () => {
    if (workspaceDraftName.trim().length === 0 || creatingWorkspace) {
      return
    }

    setCreatingWorkspace(true)
    setUploadError(null)

    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: workspaceDraftName.trim(),
        }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || "Failed to create workspace.")
      }

      onWorkspaceChange(payload.id)
      onSelectedDocumentIdsChange([])
      await onWorkspaceRefresh(payload.id)
      setWorkspaceDraftName("")
      setWorkspacePopoverOpen(false)
    } catch (error) {
      setUploadState("error")
      setUploadResult(null)
      setUploadError(
        error instanceof Error ? error.message : "Failed to create workspace.",
      )
    } finally {
      setCreatingWorkspace(false)
    }
  }

  const toggleWorkspaceDocument = (documentId: string, checked: boolean) => {
    const nextSelection = checked
      ? [...new Set([...selectedDocumentIds, documentId])]
      : selectedDocumentIds.filter((item) => item !== documentId)

    onSelectedDocumentIdsChange(nextSelection)
  }

  return (
    <PromptInput
      accept={ACCEPTED_DOCUMENT_TYPES}
      className="w-full rounded-[1.9rem] bg-background shadow-[0_12px_36px_rgba(15,23,42,0.06)] [&_[data-slot=input-group]]:rounded-[1.9rem]"
      multiple
      onError={({ message }) => {
        setUploadState("error")
        setUploadResult(null)
        setUploadError(message)
      }}
      onSubmit={({ text }) => {
        if (uploadState === "uploading") {
          setUploadState("error")
          setUploadError("Upload is still in progress.")
          return Promise.reject(new Error("Upload is still in progress."))
        }

        if (hasPendingUploads) {
          setUploadState("error")
          setUploadError("Upload selected documents before starting research.")
          return Promise.reject(
            new Error("Upload selected documents before starting research."),
          )
        }

        if (!text.trim()) {
          return Promise.reject(new Error("Enter a research topic first."))
        }

        onSubmit(text)
        return Promise.resolve()
      }}
    >
      <PromptInputBody>
        <PromptInputTextarea
          aria-label="Research topic"
          className="min-h-24 px-5 pt-5 text-base leading-7 placeholder:text-[0.98rem] placeholder:text-muted-foreground/72 sm:min-h-32 sm:px-6 sm:text-[1.05rem]"
          placeholder="Ask for a market entry brief, competitive scan, ICP analysis, pricing review, or regulatory scan…"
        />
      </PromptInputBody>

      {hasPendingUploads ? (
        <div className="px-4 pb-1 sm:px-6">
          <Attachments variant="inline">
            {pendingUploads.map((attachment) => (
              <Attachment
                data={attachment}
                key={attachment.id}
                onRemove={() => attachments.remove(attachment.id)}
              >
                <AttachmentPreview />
                <AttachmentInfo />
                <AttachmentRemove />
              </Attachment>
            ))}
          </Attachments>
        </div>
      ) : null}

      {uploadState !== "idle" && (uploadError || uploadResult) ? (
        <div className="px-4 pb-1 sm:px-6">
          <div className="rounded-2xl border border-border/60 bg-muted/35 px-4 py-3 text-sm">
            {uploadState === "uploading" ? (
              <p className="text-muted-foreground">
                Uploading documents to{" "}
                <span className="font-medium text-foreground">
                  {workspace?.name ?? "workspace"}
                </span>
                …
              </p>
            ) : null}

            {uploadResult?.uploaded.length ? (
              <p className="text-foreground">
                Uploaded {uploadResult.uploaded.length} document
                {uploadResult.uploaded.length === 1 ? "" : "s"} to{" "}
                <span className="font-medium">{workspace?.name ?? "workspace"}</span>.
              </p>
            ) : null}

            {uploadError ? (
              <p className="mt-1 text-destructive">{uploadError}</p>
            ) : null}

            {uploadResult?.failed.length ? (
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {uploadResult.failed.map((failure) => (
                  <li key={`${failure.fileName}-${failure.reason}`}>
                    {failure.fileName}: {failure.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}

      <PromptInputFooter className="flex-col items-stretch gap-3 pt-3 sm:flex-row sm:items-center">
        <PromptInputTools className="w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="inline-flex h-9 items-center gap-2 rounded-full bg-[#EAF1FF] px-3 text-sm font-medium text-[#246BFF]">
            <LauncherIcon icon={Telescope01Icon} size={18} />
            <span>Deep Research</span>
          </div>

          <Popover onOpenChange={setWorkspacePopoverOpen} open={workspacePopoverOpen}>
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
              className="w-[min(34rem,calc(100vw-1.5rem))] overflow-hidden rounded-3xl border border-border/60 bg-background p-0 shadow-[0_16px_40px_rgba(15,23,42,0.12)]"
              collisionPadding={16}
              sideOffset={10}
              style={{
                maxHeight: "min(var(--radix-popover-content-available-height), 34rem)",
              }}
            >
              <div className="border-b border-border/55 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">
                      Workspace context
                    </p>
                    <p className="text-xs leading-5 text-muted-foreground">
                      Switch workspace and choose which attached docs to use for this launch.
                    </p>
                  </div>
                  <Button
                    className="h-8 rounded-full px-3 text-xs"
                    onClick={handleCreateWorkspace}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <PlusIcon className="size-3.5" />
                    Add workspace
                  </Button>
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Input
                    className="h-9 rounded-full"
                    onChange={(event) => setWorkspaceDraftName(event.target.value)}
                    placeholder="Quick workspace name"
                    value={workspaceDraftName}
                  />
                </div>
              </div>

              <div className="overflow-y-auto p-4">
                <div className="space-y-5">
                  <section className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        Workspaces
                      </p>
                      <span className="text-xs text-muted-foreground">
                        {workspaces.length} total
                      </span>
                    </div>

                    <div className="space-y-2">
                      {visibleWorkspaces.map((item) => {
                        const isActive = item.id === activeWorkspaceId
                        return (
                          <button
                            className={cn(
                              "flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-colors",
                              isActive
                                ? "border-border bg-muted/45"
                                : "border-border/55 bg-background hover:bg-muted/30",
                            )}
                            key={item.id}
                            onClick={() => onWorkspaceChange(item.id)}
                            type="button"
                          >
                            <LauncherIcon
                              className="text-muted-foreground"
                              icon={DashboardSquare02Icon}
                              size={16}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-foreground">
                                {item.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {item.documentCount} docs
                              </p>
                            </div>
                            {isActive ? (
                              <CheckIcon className="size-4 shrink-0 text-foreground" />
                            ) : null}
                          </button>
                        )
                      })}
                    </div>

                    {overflowWorkspaces.length > 0 ? (
                      <div className="rounded-2xl border border-border/55">
                        <button
                          className="flex w-full items-center justify-between px-3 py-3 text-left text-sm font-medium text-foreground"
                          onClick={() => setShowMoreWorkspaces((current) => !current)}
                          type="button"
                        >
                          <span>
                            {showMoreWorkspaces ? "Hide" : "Show"}{" "}
                            {overflowWorkspaces.length} more workspace
                            {overflowWorkspaces.length === 1 ? "" : "s"}
                          </span>
                          <ChevronDownIcon
                            className={cn(
                              "size-4 text-muted-foreground transition-transform",
                              showMoreWorkspaces ? "rotate-180" : "",
                            )}
                          />
                        </button>
                        {showMoreWorkspaces ? (
                          <div className="space-y-2 border-t border-border/55 px-3 pb-3 pt-2">
                            {overflowWorkspaces.map((item) => {
                              const isActive = item.id === activeWorkspaceId
                              return (
                                <button
                                  className={cn(
                                    "flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-colors",
                                    isActive
                                      ? "border-border bg-muted/45"
                                      : "border-border/55 bg-background hover:bg-muted/30",
                                  )}
                                  key={item.id}
                                  onClick={() => onWorkspaceChange(item.id)}
                                  type="button"
                                >
                                  <LauncherIcon
                                    className="text-muted-foreground"
                                    icon={DashboardSquare02Icon}
                                    size={16}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-foreground">
                                      {item.name}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {item.documentCount} docs
                                    </p>
                                  </div>
                                  {isActive ? (
                                    <CheckIcon className="size-4 shrink-0 text-foreground" />
                                  ) : null}
                                </button>
                              )
                            })}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </section>

                  <div className="h-px bg-border/60" />

                  <section className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Attached documents
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {selectedDocumentIds.length} selected for this launch
                        </p>
                      </div>
                      {attachedDocuments.length > 0 ? (
                        <div className="flex items-center gap-2">
                          <Button
                            className="h-8 rounded-full px-3 text-xs"
                            onClick={() =>
                              onSelectedDocumentIdsChange(
                                attachedDocuments.map((item) => item.documentId),
                              )
                            }
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            Select all
                          </Button>
                          <Button
                            className="h-8 rounded-full px-3 text-xs"
                            onClick={() => onSelectedDocumentIdsChange([])}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            Clear
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    {attachedDocuments.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border/65 px-4 py-4 text-sm text-muted-foreground">
                        No documents are attached to this workspace yet.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {attachedDocuments.map((document) => (
                          <label
                            className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border/55 px-3 py-3 transition-colors hover:bg-muted/30"
                            key={document.documentId}
                          >
                            <Checkbox
                              checked={selectedDocumentIdSet.has(document.documentId)}
                              className="mt-0.5"
                              onCheckedChange={(value) =>
                                toggleWorkspaceDocument(
                                  document.documentId,
                                  value === true,
                                )
                              }
                            />
                            <LauncherIcon
                              className="mt-0.5 text-muted-foreground"
                              icon={File01Icon}
                              size={16}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-foreground">
                                {document.document.file_name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {document.document.total_chunks} chunks
                              </p>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <PromptInputButton
            aria-label={
              hasPendingUploads
                ? `Upload ${pendingUploads.length} selected documents`
                : "Add documents to this workspace"
            }
            className="h-9 rounded-full border border-border/55 bg-background px-3 text-sm"
            onClick={uploadPendingDocuments}
            type="button"
            variant="outline"
          >
            <LauncherIcon
              className="text-muted-foreground"
              icon={Upload04Icon}
              size={14}
            />
            <span>
              {uploadState === "uploading"
                ? "Uploading…"
                : hasPendingUploads
                  ? `Upload ${pendingUploads.length} doc${pendingUploads.length === 1 ? "" : "s"}`
                  : "Add docs"}
            </span>
          </PromptInputButton>

          <div className="order-last flex min-w-0 w-full items-center gap-2 px-1 pt-0.5 text-[0.82rem] text-muted-foreground sm:order-none sm:flex-1 sm:justify-end sm:pt-0">
            <LauncherIcon icon={FolderLibraryIcon} size={14} />
            <span className="min-w-0 truncate">
              {workspaceSummary}
            </span>
          </div>
        </PromptInputTools>

        <PromptInputSubmit
          aria-disabled={submitDisabled}
          className="ml-auto size-10 rounded-full bg-foreground text-background hover:bg-foreground/90 sm:ml-0"
        >
          <LauncherIcon icon={ArrowRight01Icon} size={18} />
        </PromptInputSubmit>
      </PromptInputFooter>
    </PromptInput>
  )
}

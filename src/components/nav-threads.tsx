"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"

import { buildSessionThreadHref } from "@/components/deep-research/utils"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import {
  SidebarGroup,
  SidebarGroupContent,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { SessionNavigationWorkspaceGroup } from "@/lib/deep-research/types"
import { cn } from "@/lib/utils"
import {
  CheckIcon,
  ChevronRightIcon,
  LayoutGridIcon,
  LoaderCircleIcon,
  PencilLineIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

function formatRelativeSessionTime(value: string) {
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) {
    return ""
  }

  const deltaMs = Date.now() - timestamp
  const deltaMinutes = Math.floor(deltaMs / (1000 * 60))

  if (deltaMinutes < 1) {
    return "now"
  }

  if (deltaMinutes < 60) {
    return `${deltaMinutes}m`
  }

  const deltaHours = Math.floor(deltaMinutes / 60)
  if (deltaHours < 24) {
    return `${deltaHours}h`
  }

  const deltaDays = Math.floor(deltaHours / 24)
  if (deltaDays < 30) {
    return `${deltaDays}d`
  }

  const deltaMonths = Math.floor(deltaDays / 30)
  return `${deltaMonths}mo`
}

export function NavThreads() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [groups, setGroups] = useState<SessionNavigationWorkspaceGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openWorkspaceIds, setOpenWorkspaceIds] = useState<string[]>([])
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [renameError, setRenameError] = useState<string | null>(null)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string
    title: string
  } | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)

  const activeSessionId = useMemo(() => {
    const match = pathname.match(/\/dashboard\/chat\/sessions\/([^/?]+)/)
    return match?.[1] ?? null
  }, [pathname])
  const searchParamsKey = searchParams.toString()

  const refreshGroups = useCallback(async () => {
    setError(null)

    try {
      const response = await fetch("/api/sessions/navigation", {
        cache: "no-store",
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || "Failed to load thread navigation.")
      }

      startTransition(() => {
        setGroups(payload)
      })
    } catch (navigationError) {
      setError(
        navigationError instanceof Error
          ? navigationError.message
          : "Failed to load thread navigation.",
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshGroups()
  }, [pathname, refreshGroups, searchParamsKey])

  useEffect(() => {
    const handleSessionsUpdated = () => {
      void refreshGroups()
    }

    window.addEventListener("sessions-updated", handleSessionsUpdated)
    const intervalId = window.setInterval(() => {
      void refreshGroups()
    }, 10000)

    return () => {
      window.removeEventListener("sessions-updated", handleSessionsUpdated)
      window.clearInterval(intervalId)
    }
  }, [refreshGroups])

  useEffect(() => {
    if (!groups.length) {
      setOpenWorkspaceIds([])
      return
    }

    setOpenWorkspaceIds((current) => {
      const availableIds = new Set(groups.map((group) => group.workspaceId))
      const preserved = current.filter((workspaceId) => availableIds.has(workspaceId))

      if (preserved.length) {
        const next = [...preserved]
        for (const group of groups) {
          if (!next.includes(group.workspaceId) && groups.length <= 3) {
            next.push(group.workspaceId)
          }
        }
        return next
      }

      const activeWorkspaceId =
        groups.find((group) =>
          group.sessions.some((session) => session.id === activeSessionId),
        )?.workspaceId ?? null

      if (activeWorkspaceId) {
        return [activeWorkspaceId]
      }

      return groups.length <= 3
        ? groups.map((group) => group.workspaceId)
        : [groups[0]?.workspaceId].filter(Boolean) as string[]
    })
  }, [activeSessionId, groups])

  const beginRename = useCallback((sessionId: string, title: string) => {
    setEditingSessionId(sessionId)
    setRenameValue(title)
    setRenameError(null)
  }, [])

  const cancelRename = useCallback(() => {
    setEditingSessionId(null)
    setRenameValue("")
    setRenameError(null)
    setRenamingSessionId(null)
  }, [])

  const closeDeleteDialog = useCallback(() => {
    if (deletingSessionId) {
      return
    }

    setDeleteTarget(null)
    setDeleteError(null)
  }, [deletingSessionId])

  const commitRename = useCallback(
    async (sessionId: string, currentTitle: string) => {
      const trimmedTitle = renameValue.trim()

      if (!trimmedTitle || trimmedTitle === currentTitle) {
        cancelRename()
        return
      }

      setRenamingSessionId(sessionId)
      setRenameError(null)

      try {
        const response = await fetch(`/api/sessions/${sessionId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: trimmedTitle,
          }),
        })
        const payload = await response.json()

        if (!response.ok) {
          throw new Error(payload.error || "Failed to rename thread.")
        }

        await refreshGroups()
        window.dispatchEvent(new Event("sessions-updated"))
        cancelRename()
      } catch (renameRequestError) {
        setRenameError(
          renameRequestError instanceof Error
            ? renameRequestError.message
            : "Failed to rename thread.",
        )
        setRenamingSessionId(null)
      }
    },
    [cancelRename, refreshGroups, renameValue],
  )

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) {
      return
    }

    setDeletingSessionId(deleteTarget.id)
    setDeleteError(null)

    try {
      const response = await fetch(`/api/sessions/${deleteTarget.id}`, {
        method: "DELETE",
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.error || "Failed to delete thread.")
      }

      const deletedSessionId = deleteTarget.id
      setDeleteTarget(null)
      setDeleteError(null)

      if (deletedSessionId === activeSessionId) {
        startTransition(() => {
          router.replace("/dashboard")
        })
      }

      await refreshGroups()
      window.dispatchEvent(new Event("sessions-updated"))
    } catch (deleteRequestError) {
      setDeleteError(
        deleteRequestError instanceof Error
          ? deleteRequestError.message
          : "Failed to delete thread.",
      )
    } finally {
      setDeletingSessionId(null)
    }
  }, [activeSessionId, deleteTarget, refreshGroups, router])

  return (
    <>
      <SidebarGroup className="min-h-0 flex-1 overflow-hidden px-3 pb-3 pt-2 group-data-[collapsible=icon]:hidden">
        <SidebarGroupContent className="min-h-0 flex h-full flex-col">
          <div className="mb-4 px-1">
            <h2 className="text-[0.7rem] font-medium uppercase tracking-[0.14em] text-sidebar-foreground/54">
              Threads
            </h2>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden pr-1">
            {loading ? (
              <div className="flex items-center gap-2 px-1 py-2 text-sm text-sidebar-foreground/60">
                <LoaderCircleIcon className="size-4 animate-spin" />
                <span>Loading threads…</span>
              </div>
            ) : error ? (
              <div className="px-1 py-2 text-sm leading-6 text-sidebar-foreground/68">
                {error}
              </div>
            ) : groups.length ? (
              <Accordion
                className="space-y-4"
                onValueChange={(value) => {
                  setOpenWorkspaceIds(Array.isArray(value) ? value : [])
                }}
                type="multiple"
                value={openWorkspaceIds}
              >
                {groups.map((group) => (
                  <AccordionItem
                    className="border-none"
                    key={group.workspaceId}
                    value={group.workspaceId}
                  >
                    <AccordionTrigger
                      className={cn(
                        "group/workspace items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-sidebar-foreground transition-transform duration-200 ease-out hover:no-underline hover:text-sidebar-foreground focus-visible:ring-sidebar-ring active:scale-[0.985] motion-reduce:transition-none [&>[data-slot=accordion-trigger-icon]]:hidden",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
                          <LayoutGridIcon
                            aria-hidden="true"
                            className="absolute size-4 text-sidebar-foreground/56 will-change-[opacity,transform,filter] transition-[opacity,transform,filter] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none group-hover/workspace:scale-[0.82] group-hover/workspace:opacity-0 group-hover/workspace:blur-[2px] group-active/workspace:scale-90"
                          />
                          <ChevronRightIcon
                            aria-hidden="true"
                            className="absolute size-4 -translate-x-0.5 scale-[0.82] text-sidebar-foreground/62 opacity-0 will-change-[opacity,transform] transition-[opacity,transform] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none group-hover/workspace:translate-x-0 group-hover/workspace:scale-100 group-hover/workspace:opacity-100 group-aria-expanded/workspace:rotate-90 group-active/workspace:scale-95"
                          />
                        </span>
                        <span
                          className="truncate text-base font-medium text-sidebar-foreground"
                          title={group.workspaceName}
                        >
                          {group.workspaceName}
                        </span>
                      </div>
                    </AccordionTrigger>

                    <AccordionContent className="pt-1">
                      <div className="space-y-1 pl-4">
                        {group.sessions.map((session) => {
                          const isActive = session.id === activeSessionId
                          const isEditing = session.id === editingSessionId
                          const isRenaming = session.id === renamingSessionId
                          const isDeleteDialogOpen = deleteTarget?.id === session.id
                          const isDeleting = deletingSessionId === session.id
                          const showActions = isActive || isDeleteDialogOpen || isDeleting
                          const disableActions =
                            renamingSessionId !== null || deletingSessionId !== null

                          if (isEditing) {
                            return (
                              <div
                                className="rounded-[1.4rem] border border-sidebar-border/60 bg-sidebar-accent/65 px-3 py-3"
                                key={session.id}
                              >
                                <label
                                  className="sr-only"
                                  htmlFor={`rename-session-${session.id}`}
                                >
                                  Rename thread
                                </label>
                                <div className="flex items-center gap-2">
                                  <Input
                                    autoComplete="off"
                                    className="h-8 border-sidebar-border/60 bg-sidebar text-sidebar-foreground"
                                    id={`rename-session-${session.id}`}
                                    name="thread-title"
                                    onChange={(event) =>
                                      setRenameValue(event.target.value)
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault()
                                        void commitRename(session.id, session.title)
                                      }

                                      if (event.key === "Escape") {
                                        event.preventDefault()
                                        cancelRename()
                                      }
                                    }}
                                    value={renameValue}
                                  />
                                  <Button
                                    aria-label="Save thread title"
                                    disabled={
                                      isRenaming || renameValue.trim().length === 0
                                    }
                                    onClick={() =>
                                      void commitRename(session.id, session.title)
                                    }
                                    size="icon-xs"
                                    variant="ghost"
                                  >
                                    {isRenaming ? (
                                      <LoaderCircleIcon className="size-3 animate-spin" />
                                    ) : (
                                      <CheckIcon className="size-3" />
                                    )}
                                  </Button>
                                  <Button
                                    aria-label="Cancel thread rename"
                                    disabled={isRenaming}
                                    onClick={cancelRename}
                                    size="icon-xs"
                                    variant="ghost"
                                  >
                                    <XIcon className="size-3" />
                                  </Button>
                                </div>
                                {renameError ? (
                                  <p className="mt-2 text-[0.72rem] leading-5 text-sidebar-foreground/70">
                                    {renameError}
                                  </p>
                                ) : null}
                              </div>
                            )
                          }

                          return (
                            <div
                              className={cn(
                                "group/thread flex items-center gap-1 rounded-[1.4rem] px-2 py-1.5 transition-colors",
                                isActive
                                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                  : "text-sidebar-foreground/72 hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground/88",
                              )}
                              key={session.id}
                            >
                              <Link
                                className="min-w-0 flex flex-1 items-center rounded-[1.1rem] px-2 py-1 decoration-transparent no-underline focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none hover:no-underline focus:no-underline active:no-underline visited:no-underline"
                                href={buildSessionThreadHref({
                                  runId: session.latestRunId,
                                  sessionId: session.id,
                                })}
                                style={{ textDecoration: "none" }}
                              >
                                <span
                                  className="min-w-0 flex-1 truncate text-[0.8rem] font-medium no-underline"
                                  title={session.title}
                                  style={{ textDecoration: "none" }}
                                >
                                  {session.title}
                                </span>
                              </Link>

                              <div
                                className={cn(
                                  "relative flex w-[4.2rem] shrink-0 items-center justify-end",
                                )}
                              >
                                <span
                                  className={cn(
                                    "pointer-events-none absolute right-0 text-[0.76rem] tabular-nums transition-[opacity,visibility]",
                                    isActive
                                      ? "invisible opacity-0"
                                      : "visible opacity-100 text-sidebar-foreground/44 group-hover/thread:invisible group-hover/thread:opacity-0",
                                  )}
                                >
                                  {formatRelativeSessionTime(session.updatedAt)}
                                </span>

                                <div
                                  className={cn(
                                    "flex items-center justify-end gap-0.5 transition-[opacity,visibility]",
                                  showActions
                                    ? "visible opacity-100"
                                    : "invisible opacity-0 group-hover/thread:visible group-hover/thread:opacity-100",
                                  )}
                                >
                                  <Button
                                    aria-label={`Rename ${session.title}`}
                                    className="shrink-0"
                                    disabled={disableActions}
                                    onClick={() => beginRename(session.id, session.title)}
                                    size="icon-xs"
                                    type="button"
                                    variant="ghost"
                                  >
                                    <PencilLineIcon className="size-3" />
                                  </Button>
                                  <Button
                                    aria-label={`Delete ${session.title}`}
                                    className="shrink-0"
                                    disabled={disableActions}
                                    onClick={() => {
                                      setDeleteTarget({
                                        id: session.id,
                                        title: session.title,
                                      })
                                      setDeleteError(null)
                                    }}
                                    size="icon-xs"
                                    type="button"
                                    variant="ghost"
                                  >
                                    {isDeleting ? (
                                      <LoaderCircleIcon className="size-3 animate-spin" />
                                    ) : (
                                      <Trash2Icon className="size-3" />
                                    )}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            ) : (
              <div className="px-1 py-2 text-sm leading-6 text-sidebar-foreground/60">
                Start a session from the dashboard and your threads will appear here.
              </div>
            )}
          </div>
        </SidebarGroupContent>
      </SidebarGroup>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            closeDeleteDialog()
          }
        }}
        open={deleteTarget !== null}
      >
        <DialogContent showCloseButton={!deletingSessionId}>
          <DialogHeader>
            <DialogTitle>Delete thread permanently?</DialogTitle>
            <DialogDescription>
              This will permanently remove the thread, its chat messages, and any
              deep research history tied to it. Published workspace knowledge and
              attached library documents will remain in the workspace.
            </DialogDescription>
          </DialogHeader>

          {deleteTarget ? (
            <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm">
              <p className="font-medium text-foreground">{deleteTarget.title}</p>
            </div>
          ) : null}

          {deleteError ? (
            <p className="text-sm text-destructive">{deleteError}</p>
          ) : null}

          <DialogFooter>
            <Button
              disabled={deletingSessionId !== null}
              onClick={closeDeleteDialog}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={deletingSessionId !== null}
              onClick={() => void confirmDelete()}
              type="button"
              variant="destructive"
            >
              {deletingSessionId ? (
                <>
                  <LoaderCircleIcon className="size-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete thread"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

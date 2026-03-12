"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
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
import type { SessionNavigationWorkspaceGroup } from "@/lib/deep-research/types"
import { cn } from "@/lib/utils"
import {
  ChevronRightIcon,
  LayoutGridIcon,
  LoaderCircleIcon,
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
  const searchParams = useSearchParams()
  const [groups, setGroups] = useState<SessionNavigationWorkspaceGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openWorkspaceIds, setOpenWorkspaceIds] = useState<string[]>([])

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

  return (
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

                        return (
                          <Link
                            key={session.id}
                            className={cn(
                              "group/thread flex items-center gap-3 rounded-[1.4rem] px-4 py-2.5 decoration-transparent no-underline transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none hover:no-underline focus:no-underline active:no-underline visited:no-underline",
                              isActive
                                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                : "text-sidebar-foreground/72 hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground/88",
                            )}
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
                            <span
                              className={cn(
                                "shrink-0 text-[0.76rem] tabular-nums no-underline transition-colors",
                                isActive
                                  ? "text-sidebar-accent-foreground/60"
                                  : "text-sidebar-foreground/44 group-hover/thread:text-sidebar-accent-foreground/60",
                              )}
                              style={{ textDecoration: "none" }}
                            >
                              {formatRelativeSessionTime(session.updatedAt)}
                            </span>
                          </Link>
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
  )
}

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
  SidebarGroup,
  SidebarGroupContent,
} from "@/components/ui/sidebar"
import type { SessionNavigationWorkspaceGroup } from "@/lib/deep-research/types"
import { cn } from "@/lib/utils"
import {
  FolderIcon,
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

  return (
    <SidebarGroup className="min-h-0 flex-1 overflow-hidden px-3 pb-3 pt-2 group-data-[collapsible=icon]:hidden">
      <SidebarGroupContent className="min-h-0 flex h-full flex-col">
        <div className="mb-4 px-1">
          <h2 className="text-sm font-medium text-sidebar-foreground/72">
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
            groups.map((group) => (
              <section key={group.workspaceId} className="space-y-2">
                <div className="flex items-center gap-2.5 px-1.5 text-sidebar-foreground/72">
                  <FolderIcon className="size-4 shrink-0" />
                  <span
                    className="truncate text-sm font-medium"
                    title={group.workspaceName}
                  >
                    {group.workspaceName}
                  </span>
                </div>

                <div className="space-y-1 pl-7">
                  {group.sessions.map((session) => {
                    const isActive = session.id === activeSessionId

                    return (
                      <Link
                        key={session.id}
                        className={cn(
                          "group/thread flex items-center gap-3 rounded-[1.65rem] px-4 py-3 transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none",
                          isActive
                            ? "bg-sidebar-accent/90 text-sidebar-accent-foreground"
                            : "text-sidebar-foreground/84 hover:bg-sidebar-accent/55 hover:text-sidebar-accent-foreground",
                        )}
                        href={buildSessionThreadHref({
                          runId: session.latestRunId,
                          sessionId: session.id,
                        })}
                      >
                        <span
                          className="min-w-0 flex-1 truncate text-[0.95rem] font-medium"
                          title={session.title}
                        >
                          {session.title}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 text-sm tabular-nums transition-colors",
                            isActive
                              ? "text-sidebar-accent-foreground/58"
                              : "text-sidebar-foreground/46 group-hover/thread:text-sidebar-accent-foreground/58",
                          )}
                        >
                          {formatRelativeSessionTime(session.updatedAt)}
                        </span>
                      </Link>
                    )
                  })}
                </div>
              </section>
            ))
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

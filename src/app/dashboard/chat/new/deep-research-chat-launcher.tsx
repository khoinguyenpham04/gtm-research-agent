"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  startTransition,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import type { DocumentSummary } from "@/lib/documents"
import { DeepResearchThreadLauncher } from "@/app/dashboard/chat/deep-research-thread-launcher"
import { DeepResearchThreadShell } from "@/components/deep-research/thread-ui"
import { buildSessionThreadHref } from "@/components/deep-research/utils"
import type {
  WorkspaceDetail,
  WorkspaceSummary,
} from "@/lib/workspaces"

export function DeepResearchChatLauncher({
  fallbackHref,
  launchKey,
  objective,
  initialWorkspace,
  initialWorkspaces,
  sessionId,
  selectedDocumentIds,
  selectedDocuments,
  topic,
  workspaceId,
  workspaceName,
}: {
  topic: string
  objective?: string
  initialWorkspace: WorkspaceDetail | null
  initialWorkspaces: WorkspaceSummary[]
  workspaceId: string
  workspaceName?: string
  launchKey: string
  fallbackHref: string
  selectedDocumentIds: string[]
  selectedDocuments: DocumentSummary[]
  sessionId?: string
}) {
  const router = useRouter()
  const startedRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  const launchError = useMemo(() => {
    if (!topic.trim()) {
      return "Enter a research topic before starting a thread."
    }

    if (!workspaceId) {
      return "Select a workspace before starting research."
    }

    return null
  }, [topic, workspaceId])

  const createRun = useCallback(
    async (nextTopic: string) => {
      const trimmedTopic = nextTopic.trim()
      if (!trimmedTopic) {
        setError("Enter a research topic before starting a thread.")
        return
      }

      setError(null)
      setIsCreating(true)

      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), 15000)

      try {
        const response = await fetch("/api/deep-research/runs", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            launchKey,
            objective: objective || undefined,
            sessionId,
            selectedDocumentIds,
            topic: trimmedTopic,
            workspaceId,
          }),
          signal: controller.signal,
        })
        const payload = await response.json()

        if (!response.ok) {
          throw new Error(payload.error || "Failed to create research run.")
        }

        if (!payload.sessionId) {
          throw new Error("Research run did not return an owning session.")
        }

        window.dispatchEvent(new Event("sessions-updated"))
        startTransition(() => {
          router.replace(
            buildSessionThreadHref({
              mode: "research",
              runId: payload.id,
              sessionId: payload.sessionId,
            }),
          )
        })
      } catch (createError) {
        setError(
          createError instanceof Error && createError.name === "AbortError"
            ? "Launching deep research is taking longer than expected. You can retry from this page."
            : createError instanceof Error
              ? createError.message
              : "Failed to create research run.",
        )
      } finally {
        window.clearTimeout(timeoutId)
        setIsCreating(false)
      }
    },
    [launchKey, objective, router, selectedDocumentIds, sessionId, workspaceId],
  )

  useEffect(() => {
    if (launchError || startedRef.current) {
      return
    }

    startedRef.current = true
    setIsCreating(true)
    void createRun(topic)
  }, [createRun, launchError, topic])

  return (
    <DeepResearchThreadShell
      actions={
        launchError || error ? (
          <>
            <ButtonLink href="/dashboard">Back to dashboard</ButtonLink>
            <ButtonLink href={fallbackHref}>Open fallback console</ButtonLink>
          </>
        ) : null
      }
      citedSources={[]}
      clarificationResponse=""
      error={launchError ?? error}
      launchPending={!launchError && isCreating}
      onClarificationResponseChange={() => undefined}
      preResearchPlan={null}
      run={null}
      selectedDocuments={selectedDocuments}
      topic={topic}
      workspaceName={workspaceName}
      objective={objective}
      composer={
        <DeepResearchThreadLauncher
          initialSelectedDocumentIds={selectedDocumentIds}
          initialTopic={topic}
          initialWorkspace={initialWorkspace}
          initialWorkspaceId={workspaceId}
          initialWorkspaces={initialWorkspaces}
          navigationMode="replace"
          objective={objective}
          sessionId={sessionId}
        />
      }
    />
  )
}

function ButtonLink({
  children,
  href,
}: {
  href: string
  children: ReactNode
}) {
  return (
    <Link
      className="inline-flex h-10 items-center justify-center rounded-full border border-border/60 px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/30"
      href={href}
    >
      {children}
    </Link>
  )
}

"use client"

import { useRouter } from "next/navigation"
import { startTransition, useCallback, useEffect, useState } from "react"

import {
  DashboardResearchLauncher,
} from "@/app/dashboard/dashboard-research-launcher"
import {
  PromptInputProvider,
} from "@/components/ai-elements/prompt-input"
import { buildDeepResearchChatNewHref } from "@/components/deep-research/utils"
import type {
  WorkspaceDetail,
  WorkspaceSummary,
} from "@/lib/workspaces"

export function DeepResearchThreadLauncher({
  initialSelectedDocumentIds,
  initialTopic = "",
  initialWorkspace,
  initialWorkspaceId,
  initialWorkspaces,
  navigationMode = "push",
  objective,
  sessionId,
}: {
  initialWorkspaceId: string
  initialWorkspace: WorkspaceDetail | null
  initialWorkspaces: WorkspaceSummary[]
  initialSelectedDocumentIds?: string[]
  initialTopic?: string
  objective?: string
  sessionId?: string
  navigationMode?: "push" | "replace"
}) {
  return (
    <PromptInputProvider initialInput={initialTopic}>
      <DeepResearchThreadLauncherInner
        initialSelectedDocumentIds={initialSelectedDocumentIds}
        initialWorkspace={initialWorkspace}
        initialWorkspaceId={initialWorkspaceId}
        initialWorkspaces={initialWorkspaces}
        navigationMode={navigationMode}
        objective={objective}
        sessionId={sessionId}
      />
    </PromptInputProvider>
  )
}

function DeepResearchThreadLauncherInner({
  initialSelectedDocumentIds,
  initialWorkspace,
  initialWorkspaceId,
  initialWorkspaces,
  navigationMode,
  objective,
  sessionId,
}: {
  initialWorkspaceId: string
  initialWorkspace: WorkspaceDetail | null
  initialWorkspaces: WorkspaceSummary[]
  initialSelectedDocumentIds?: string[]
  objective?: string
  sessionId?: string
  navigationMode: "push" | "replace"
}) {
  const router = useRouter()
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(initialWorkspaceId)
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(initialWorkspace)
  const [workspaces, setWorkspaces] = useState(initialWorkspaces)
  const [selectedDocumentIds, setSelectedDocumentIds] = useState(
    initialSelectedDocumentIds && initialSelectedDocumentIds.length > 0
      ? initialSelectedDocumentIds
      : initialWorkspace?.documents.map((attachment) => attachment.documentId) ?? [],
  )

  const refreshWorkspaceContext = useCallback(async (workspaceId: string) => {
    if (!workspaceId) {
      startTransition(() => {
        setWorkspace(null)
        setSelectedDocumentIds([])
      })
      return
    }

    const response = await fetch(`/api/workspaces/${workspaceId}`, {
      cache: "no-store",
    })
    const payload = await response.json()

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load workspace.")
    }

    startTransition(() => {
      setWorkspace(payload)
      setSelectedDocumentIds(
        payload.documents.map(
          (attachment: WorkspaceDetail["documents"][number]) =>
            attachment.documentId,
        ),
      )
    })
  }, [])

  const refreshWorkspaces = useCallback(async () => {
    const response = await fetch("/api/workspaces", {
      cache: "no-store",
    })
    const payload = await response.json()

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load workspaces.")
    }

    startTransition(() => {
      setWorkspaces(payload.workspaces)
    })
  }, [])

  const handleWorkspaceRefresh = useCallback(
    async (workspaceId: string) => {
      await Promise.all([
        refreshWorkspaceContext(workspaceId),
        refreshWorkspaces(),
      ])
    },
    [refreshWorkspaceContext, refreshWorkspaces],
  )

  useEffect(() => {
    if (!activeWorkspaceId || activeWorkspaceId === workspace?.id) {
      return
    }

    void refreshWorkspaceContext(activeWorkspaceId)
  }, [activeWorkspaceId, refreshWorkspaceContext, workspace?.id])

  return (
    <div className="mx-auto w-full max-w-4xl">
      <DashboardResearchLauncher
        activeWorkspaceId={activeWorkspaceId}
        onSelectedDocumentIdsChange={setSelectedDocumentIds}
        onSubmit={(submittedTopic) => {
          const nextTopic = submittedTopic?.trim()
          if (!nextTopic) {
            return
          }

          const href = buildDeepResearchChatNewHref({
            launchKey: crypto.randomUUID(),
            objective,
            sessionId,
            selectedDocumentIds,
            topic: nextTopic,
            workspaceId: activeWorkspaceId,
          })

          startTransition(() => {
            if (navigationMode === "replace") {
              router.replace(href)
              return
            }

            router.push(href)
          })
        }}
        onWorkspaceChange={setActiveWorkspaceId}
        onWorkspaceRefresh={handleWorkspaceRefresh}
        selectedDocumentIds={selectedDocumentIds}
        workspace={workspace}
        workspaceDocumentCount={workspace?.documents.length ?? 0}
        workspaces={workspaces}
      />
    </div>
  )
}

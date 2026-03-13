"use client"

import { startTransition, useCallback, useEffect, useRef, useState } from "react"
import type { ComponentProps } from "react"

import {
  DashboardResearchLauncher,
} from "@/app/dashboard/dashboard-research-launcher"
import {
  PromptInputProvider,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input"
import type { SessionComposerMode } from "@/lib/deep-research/types"
import type {
  WorkspaceDetail,
  WorkspaceSummary,
} from "@/lib/workspaces"

type ComposerSubmitPayload = {
  selectedDocumentIds: string[]
  text: string
  workspaceId: string
}

type SelectionPrefill = {
  documentIds: string[]
  token: number
}

type LauncherSubmitStatus = ComponentProps<
  typeof DashboardResearchLauncher
>["submitStatus"]

export function SessionThreadComposer({
  initialSelectedDocumentIds,
  initialWorkspace,
  initialWorkspaceId,
  initialWorkspaces,
  isChatSubmitting,
  isResearchSubmitting,
  chatSubmitStatus,
  mode,
  onStopChat,
  onStopResearch,
  onChatSubmit,
  onModeChange,
  onResearchSubmit,
  prefill,
  selectionPrefill,
}: {
  initialWorkspaceId: string
  initialWorkspace: WorkspaceDetail | null
  initialWorkspaces: WorkspaceSummary[]
  initialSelectedDocumentIds?: string[]
  isChatSubmitting: boolean
  isResearchSubmitting: boolean
  chatSubmitStatus?: LauncherSubmitStatus
  mode: SessionComposerMode
  prefill?: {
    text: string
    token: number
  } | null
  selectionPrefill?: SelectionPrefill | null
  onStopChat?: () => void
  onStopResearch?: () => void
  onChatSubmit: (payload: ComposerSubmitPayload) => Promise<void> | void
  onModeChange: (mode: SessionComposerMode) => void
  onResearchSubmit: (payload: ComposerSubmitPayload) => Promise<void> | void
}) {
  return (
    <PromptInputProvider initialInput={prefill?.text ?? ""}>
      <SessionThreadComposerInner
        initialSelectedDocumentIds={initialSelectedDocumentIds}
        initialWorkspace={initialWorkspace}
        initialWorkspaceId={initialWorkspaceId}
        initialWorkspaces={initialWorkspaces}
        chatSubmitStatus={chatSubmitStatus}
        isChatSubmitting={isChatSubmitting}
        isResearchSubmitting={isResearchSubmitting}
        mode={mode}
        onStopChat={onStopChat}
        onStopResearch={onStopResearch}
        onChatSubmit={onChatSubmit}
        onModeChange={onModeChange}
        onResearchSubmit={onResearchSubmit}
        prefill={prefill}
        selectionPrefill={selectionPrefill}
      />
    </PromptInputProvider>
  )
}

function SessionThreadComposerInner({
  initialSelectedDocumentIds,
  initialWorkspace,
  initialWorkspaceId,
  initialWorkspaces,
  isChatSubmitting,
  isResearchSubmitting,
  chatSubmitStatus,
  mode,
  onStopChat,
  onStopResearch,
  onChatSubmit,
  onModeChange,
  onResearchSubmit,
  prefill,
  selectionPrefill,
}: {
  initialWorkspaceId: string
  initialWorkspace: WorkspaceDetail | null
  initialWorkspaces: WorkspaceSummary[]
  initialSelectedDocumentIds?: string[]
  isChatSubmitting: boolean
  isResearchSubmitting: boolean
  chatSubmitStatus?: LauncherSubmitStatus
  mode: SessionComposerMode
  onStopChat?: () => void
  onStopResearch?: () => void
  onChatSubmit: (payload: ComposerSubmitPayload) => Promise<void> | void
  onModeChange: (mode: SessionComposerMode) => void
  onResearchSubmit: (payload: ComposerSubmitPayload) => Promise<void> | void
  prefill?: {
    text: string
    token: number
  } | null
  selectionPrefill?: SelectionPrefill | null
}) {
  const promptController = usePromptInputController()
  const appliedPrefillTokenRef = useRef<number | null>(null)
  const appliedSelectionTokenRef = useRef<number | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(initialWorkspace)
  const [workspaces, setWorkspaces] = useState(initialWorkspaces)
  const [selectedDocumentIds, setSelectedDocumentIds] = useState(
    initialSelectedDocumentIds && initialSelectedDocumentIds.length > 0
      ? initialSelectedDocumentIds
      : initialWorkspace?.documents.map((attachment) => attachment.documentId) ?? [],
  )

  const refreshWorkspaceContext = useCallback(async () => {
    if (!initialWorkspaceId) {
      return
    }

    const response = await fetch(`/api/workspaces/${initialWorkspaceId}`, {
      cache: "no-store",
    })
    const payload = await response.json()

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load workspace.")
    }

    startTransition(() => {
      setWorkspace(payload)
      setSelectedDocumentIds((current) => {
        if (current.length === 0) {
          return payload.documents.map(
            (attachment: WorkspaceDetail["documents"][number]) =>
              attachment.documentId,
          )
        }

        const validDocumentIds = new Set(
          payload.documents.map(
            (attachment: WorkspaceDetail["documents"][number]) =>
              attachment.documentId,
          ),
        )

        return current.filter((documentId) => validDocumentIds.has(documentId))
      })
    })
  }, [initialWorkspaceId])

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

  useEffect(() => {
    if (!prefill || appliedPrefillTokenRef.current === prefill.token) {
      return
    }

    appliedPrefillTokenRef.current = prefill.token
    promptController.textInput.setInput(prefill.text)
  }, [prefill, promptController.textInput])

  useEffect(() => {
    if (
      !selectionPrefill ||
      appliedSelectionTokenRef.current === selectionPrefill.token
    ) {
      return
    }

    appliedSelectionTokenRef.current = selectionPrefill.token
    const validDocumentIds = new Set(
      (workspace?.documents ?? []).map((attachment) => attachment.documentId),
    )
    const frameId = window.requestAnimationFrame(() => {
      setSelectedDocumentIds(
        selectionPrefill.documentIds.filter((documentId) =>
          validDocumentIds.has(documentId),
        ),
      )
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [selectionPrefill, workspace?.documents])

  useEffect(() => {
    const handleWorkspaceKnowledgeUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{
        workspaceId?: string
        documentId?: string
      }>).detail

      if (!detail || detail.workspaceId !== initialWorkspaceId) {
        return
      }

      void Promise.all([refreshWorkspaceContext(), refreshWorkspaces()]).then(() => {
        if (!detail.documentId) {
          return
        }

        startTransition(() => {
          setSelectedDocumentIds((current) =>
            current.includes(detail.documentId as string)
              ? current
              : [...current, detail.documentId as string],
          )
        })
      })
    }

    window.addEventListener(
      "workspace-knowledge-updated",
      handleWorkspaceKnowledgeUpdate as EventListener,
    )

    return () => {
      window.removeEventListener(
        "workspace-knowledge-updated",
        handleWorkspaceKnowledgeUpdate as EventListener,
      )
    }
  }, [initialWorkspaceId, refreshWorkspaceContext, refreshWorkspaces])

  return (
    <div className="mx-auto w-full max-w-4xl">
      <DashboardResearchLauncher
        activeWorkspaceId={initialWorkspaceId}
        allowWorkspaceChange={false}
        isSubmitting={mode === "chat" ? isChatSubmitting : isResearchSubmitting}
        mode={mode}
        onModeChange={onModeChange}
        onSelectedDocumentIdsChange={setSelectedDocumentIds}
        onStop={mode === "chat" ? onStopChat : onStopResearch}
        onSubmit={(submittedText) => {
          const trimmedText = submittedText?.trim()
          if (!trimmedText) {
            return
          }

          const payload = {
            selectedDocumentIds,
            text: trimmedText,
            workspaceId: initialWorkspaceId,
          }

          if (mode === "chat") {
            return onChatSubmit(payload)
          }

          return onResearchSubmit(payload)
        }}
        onWorkspaceChange={() => undefined}
        onWorkspaceRefresh={async () => {
          await Promise.all([refreshWorkspaceContext(), refreshWorkspaces()])
        }}
        selectedDocumentIds={selectedDocumentIds}
        submitStatus={
          mode === "chat"
            ? chatSubmitStatus
            : isResearchSubmitting
              ? "submitted"
              : undefined
        }
        workspace={workspace}
        workspaceDocumentCount={workspace?.documents.length ?? 0}
        workspaces={workspaces}
      />
    </div>
  )
}

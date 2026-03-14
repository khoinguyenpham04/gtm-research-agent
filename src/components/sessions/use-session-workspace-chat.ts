"use client"

import { startTransition, useCallback, useRef, useState } from "react"

import type {
  WorkspaceChatCitation,
  WorkspaceChatMessageMetadata,
  WorkspaceChatTraceEvent,
} from "@/lib/deep-research/types"

export type AskWorkspaceStatus =
  | "idle"
  | "starting"
  | "retrieving"
  | "streaming"
  | "error"

export type PendingWorkspaceTurn = {
  assistantMessageId: string
  requestId: string
  userMessageId: string
}

type StreamEvent = {
  data: string
  event: string
}

function buildTraceEvent(
  stage: WorkspaceChatTraceEvent["stage"],
  message: string,
  details: Record<string, unknown> = {},
): WorkspaceChatTraceEvent {
  return {
    createdAt: new Date().toISOString(),
    details,
    id: crypto.randomUUID(),
    message,
    stage,
  }
}

function mergeTraceEvent(
  current: WorkspaceChatTraceEvent[],
  nextTraceEvent: WorkspaceChatTraceEvent,
) {
  const existingEventIndex = current.findIndex(
    (event) =>
      event.id === nextTraceEvent.id ||
      (event.stage === nextTraceEvent.stage &&
        event.details?.optimistic === true),
  )

  if (existingEventIndex === -1) {
    return [...current, nextTraceEvent].sort(
      (left, right) =>
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
    )
  }

  const nextEvents = [...current]
  nextEvents[existingEventIndex] = {
    ...nextEvents[existingEventIndex],
    ...nextTraceEvent,
    details: {
      ...nextEvents[existingEventIndex].details,
      ...nextTraceEvent.details,
    },
  }

  return nextEvents
}

function parseSseEvents(buffer: string) {
  const events: StreamEvent[] = []
  let remaining = buffer

  while (true) {
    const separatorIndex = remaining.indexOf("\n\n")
    if (separatorIndex === -1) {
      break
    }

    const rawEvent = remaining.slice(0, separatorIndex)
    remaining = remaining.slice(separatorIndex + 2)

    let eventName = "message"
    const dataLines: string[] = []

    rawEvent.split("\n").forEach((line) => {
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim()
        return
      }

      if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim())
      }
    })

    if (dataLines.length > 0) {
      events.push({
        data: dataLines.join("\n"),
        event: eventName,
      })
    }
  }

  return {
    events,
    remaining,
  }
}

export function useSessionWorkspaceChat({
  onPersisted,
  sessionId,
}: {
  sessionId: string
  onPersisted: () => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<AskWorkspaceStatus>("idle")
  const [streamingAssistantText, setStreamingAssistantText] = useState("")
  const [transientMetadata, setTransientMetadata] =
    useState<WorkspaceChatMessageMetadata | null>(null)
  const [transientSources, setTransientSources] = useState<
    WorkspaceChatCitation[]
  >([])
  const [transientTraceEvents, setTransientTraceEvents] = useState<
    WorkspaceChatTraceEvent[]
  >([])
  const [transientUserText, setTransientUserText] = useState<string | null>(null)
  const [pendingTurn, setPendingTurn] = useState<PendingWorkspaceTurn | null>(
    null,
  )
  const [requestId, setRequestId] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const clearTransient = useCallback(() => {
    startTransition(() => {
      setPendingTurn(null)
      setRequestId(null)
      setStatus("idle")
      setStreamingAssistantText("")
      setTransientMetadata(null)
      setTransientSources([])
      setTransientTraceEvents([])
      setTransientUserText(null)
    })
  }, [])

  const stopWorkspaceMessage = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setStatus("idle")
  }, [])

  const acknowledgePersistedWorkspaceTurn = useCallback(() => {
    clearTransient()
  }, [clearTransient])

  const sendWorkspaceMessage = useCallback(
    async ({
      selectedDocumentIds,
      text,
    }: {
      selectedDocumentIds: string[]
      text: string
    }) => {
      const trimmedText = text.trim()
      if (!trimmedText) {
        return
      }

      abortControllerRef.current?.abort()
      const controller = new AbortController()
      abortControllerRef.current = controller
      const nextRequestId = crypto.randomUUID()

      setError(null)
      setStatus("starting")
      setPendingTurn(null)
      setStreamingAssistantText("")
      setTransientMetadata(null)
      setTransientSources([])
      setTransientTraceEvents([
        buildTraceEvent("starting", "Ask Workspace request started.", {
          optimistic: true,
          requestId: nextRequestId,
        }),
      ])
      setTransientUserText(trimmedText)
      setRequestId(nextRequestId)

      try {
        const response = await fetch(`/api/sessions/${sessionId}/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            selectedDocumentIds,
            text: trimmedText,
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}))
          throw new Error(
            payload.error || "Workspace chat failed to start.",
          )
        }

        if (!response.body) {
          throw new Error("Workspace chat did not return a response stream.")
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            break
          }

          buffer += decoder.decode(value, {
            stream: true,
          })

          const parsed = parseSseEvents(buffer)
          buffer = parsed.remaining

          for (const event of parsed.events) {
            const payload = JSON.parse(event.data) as Record<string, unknown>

            if (event.event === "status") {
              const nextStatus =
                typeof payload.phase === "string"
                  ? (payload.phase as AskWorkspaceStatus)
                  : null

              if (nextStatus) {
                setStatus(nextStatus)
              }

              if (typeof payload.requestId === "string") {
                setRequestId(payload.requestId)
              }

              continue
            }

            if (event.event === "reasoning") {
              const metadata = payload.metadata as WorkspaceChatMessageMetadata
              setTransientMetadata(metadata)
              if (Array.isArray(metadata?.sources)) {
                setTransientSources(metadata.sources)
              }
              if (Array.isArray(metadata?.traceEvents)) {
                setTransientTraceEvents((current) =>
                  metadata.traceEvents.reduce(mergeTraceEvent, current),
                )
              }
              continue
            }

            if (event.event === "sources") {
              if (Array.isArray(payload.sources)) {
                setTransientSources(payload.sources as WorkspaceChatCitation[])
              }
              continue
            }

            if (event.event === "trace") {
              const traceEvent = payload.traceEvent as WorkspaceChatTraceEvent | undefined
              if (traceEvent) {
                setTransientTraceEvents((current) =>
                  mergeTraceEvent(current, traceEvent),
                )
              }
              continue
            }

            if (event.event === "assistant_delta") {
              const delta =
                typeof payload.delta === "string" ? payload.delta : ""
              if (delta) {
                setStatus("streaming")
                setStreamingAssistantText((current) => current + delta)
              }
              continue
            }

            if (event.event === "done") {
              if (
                typeof payload.assistantMessageId === "string" &&
                typeof payload.requestId === "string" &&
                typeof payload.userMessageId === "string"
              ) {
                setPendingTurn({
                  assistantMessageId: payload.assistantMessageId,
                  requestId: payload.requestId,
                  userMessageId: payload.userMessageId,
                })
              }
              setStatus("idle")
              await onPersisted()
              abortControllerRef.current = null
              return
            }

            if (event.event === "error") {
              const message =
                typeof payload.message === "string"
                  ? payload.message
                  : "Workspace chat failed to generate a response."
              setError(message)
              setStatus("error")
              abortControllerRef.current = null
              return
            }
          }
        }

        if (controller.signal.aborted) {
          await onPersisted()
          clearTransient()
          abortControllerRef.current = null
          return
        }

        throw new Error("Workspace chat stream ended unexpectedly.")
      } catch (nextError) {
        if (nextError instanceof Error && nextError.name === "AbortError") {
          await onPersisted()
          clearTransient()
          abortControllerRef.current = null
          return
        }

        setError(
          nextError instanceof Error
            ? nextError.message
            : "Workspace chat failed to generate a response.",
        )
        setTransientTraceEvents((current) => [
          ...current,
          buildTraceEvent(
            "error",
            nextError instanceof Error
              ? nextError.message
              : "Workspace chat failed to generate a response.",
          ),
        ])
        setStatus("error")
        abortControllerRef.current = null
      }
    },
    [clearTransient, onPersisted, sessionId],
  )

  return {
    chatError: error,
    chatStatus: status,
    acknowledgePersistedWorkspaceTurn,
    pendingTurn,
    requestId,
    sendWorkspaceMessage,
    stopWorkspaceMessage,
    transientAssistantMetadata: transientMetadata,
    transientAssistantSources: transientSources,
    transientAssistantText: streamingAssistantText,
    transientTraceEvents,
    transientUserText,
  }
}

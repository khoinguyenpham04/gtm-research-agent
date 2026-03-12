"use client"

import { startTransition, useCallback, useEffect, useMemo, useState } from "react"

import type {
  DeepResearchRunResponse,
  SessionThreadResponse,
} from "@/lib/deep-research/types"

function replaceRunInThread(
  thread: SessionThreadResponse | null,
  nextRun: DeepResearchRunResponse,
) {
  if (!thread) {
    return thread
  }

  return {
    ...thread,
    messages: thread.messages.map((message) =>
      message.linkedRun?.id === nextRun.id
        ? {
            ...message,
            linkedRun: nextRun,
          }
        : message,
    ),
  }
}

export function useSessionThread(initialThread: SessionThreadResponse | null) {
  const [thread, setThreadState] = useState(initialThread)
  const [clarificationResponses, setClarificationResponses] = useState<
    Record<string, string>
  >({})
  const [submittingRunId, setSubmittingRunId] = useState<string | null>(null)
  const [submissionAction, setSubmissionAction] = useState<"resume" | "retry" | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)

  const activeRuns = useMemo(
    () =>
      (thread?.messages ?? []).flatMap((message) => {
        const run = message.linkedRun
        if (!run) {
          return []
        }

        return run.status === "queued" || run.status === "running" ? [run] : []
      }),
    [thread],
  )

  const setThread = useCallback((nextThread: SessionThreadResponse | null) => {
    startTransition(() => {
      setThreadState(nextThread)
      setError(null)
    })
  }, [])

  const refreshThread = useCallback(async () => {
    if (!thread?.session.id) {
      return
    }

    const response = await fetch(`/api/sessions/${thread.session.id}`, {
      cache: "no-store",
    })
    const payload = await response.json()

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load session thread.")
    }

    setThread(payload)
  }, [setThread, thread?.session.id])

  useEffect(() => {
    if (!thread?.session.id || activeRuns.length === 0) {
      return
    }

    const intervalId = window.setInterval(() => {
      void refreshThread().catch((pollError) => {
        setError(
          pollError instanceof Error
            ? pollError.message
            : "Failed to poll session thread.",
        )
      })
    }, 2500)

    return () => window.clearInterval(intervalId)
  }, [activeRuns.length, refreshThread, thread?.session.id])

  const setClarificationResponse = useCallback((runId: string, value: string) => {
    setClarificationResponses((current) => ({
      ...current,
      [runId]: value,
    }))
  }, [])

  const resumeRun = useCallback(
    async (run: DeepResearchRunResponse) => {
      setSubmittingRunId(run.id)
      setSubmissionAction("resume")
      setError(null)

      try {
        const response = await fetch(`/api/deep-research/runs/${run.id}/resume`, {
          method: "POST",
          headers:
            run.status === "needs_clarification"
              ? {
                  "Content-Type": "application/json",
                }
              : undefined,
          body:
            run.status === "needs_clarification"
              ? JSON.stringify({
                  clarificationResponse: clarificationResponses[run.id]?.trim() ?? "",
                })
              : undefined,
        })
        const payload = await response.json()

        if (!response.ok) {
          throw new Error(payload.error || "Failed to resume research run.")
        }

        startTransition(() => {
          setThreadState((current) => replaceRunInThread(current, payload))
          if (run.status === "needs_clarification") {
            setClarificationResponses((current) => {
              const next = { ...current }
              delete next[run.id]
              return next
            })
          }
        })
      } catch (resumeError) {
        setError(
          resumeError instanceof Error
            ? resumeError.message
            : "Failed to resume research run.",
        )
      } finally {
        setSubmittingRunId(null)
        setSubmissionAction(null)
      }
    },
    [clarificationResponses],
  )

  const retryRun = useCallback(async (runId: string) => {
    setSubmittingRunId(runId)
    setSubmissionAction("retry")
    setError(null)

    try {
      const response = await fetch(`/api/deep-research/runs/${runId}/retry`, {
        method: "POST",
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || "Failed to retry research run.")
      }

      startTransition(() => {
        setThreadState((current) => replaceRunInThread(current, payload))
      })
    } catch (retryError) {
      setError(
        retryError instanceof Error
          ? retryError.message
          : "Failed to retry research run.",
      )
    } finally {
      setSubmittingRunId(null)
      setSubmissionAction(null)
    }
  }, [])

  return {
    clarificationResponses,
    error,
    refreshThread,
    resumeRun,
    retryRun,
    session: thread?.session ?? null,
    setClarificationResponse,
    setThread,
    submissionAction,
    submittingRunId,
    thread,
  }
}

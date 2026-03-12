"use client"

import { startTransition, useCallback, useEffect, useMemo, useState } from "react"

import type { DeepResearchRunResponse } from "@/lib/deep-research/types"
import {
  extractActiveRateLimitRetry,
  extractPreResearchPlan,
  extractSourcesFromReport,
} from "@/components/deep-research/utils"

export function useDeepResearchRun(initialRun: DeepResearchRunResponse | null) {
  const [run, setRunState] = useState<DeepResearchRunResponse | null>(initialRun)
  const [clarificationResponse, setClarificationResponse] = useState("")
  const [submissionAction, setSubmissionAction] = useState<"resume" | "retry" | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isPolling = run?.status === "queued" || run?.status === "running"
  const citedSources = useMemo(
    () => extractSourcesFromReport(run?.finalReportMarkdown),
    [run?.finalReportMarkdown],
  )
  const preResearchPlan = useMemo(
    () => extractPreResearchPlan(run?.events),
    [run?.events],
  )
  const activeRateLimitRetry = useMemo(
    () => extractActiveRateLimitRetry(run),
    [run],
  )

  const setRun = useCallback((nextRun: DeepResearchRunResponse | null) => {
    startTransition(() => {
      setRunState(nextRun)
      setError(null)

      if (nextRun?.status !== "needs_clarification") {
        setClarificationResponse("")
      }
    })
  }, [])

  useEffect(() => {
    if (!run?.id || !isPolling) {
      return
    }

    const intervalId = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/deep-research/runs/${run.id}`, {
          cache: "no-store",
        })
        const payload = await response.json()
        if (!response.ok) {
          throw new Error(payload.error || "Failed to poll research run.")
        }

        setRun(payload)
      } catch (pollError) {
        setError(
          pollError instanceof Error
            ? pollError.message
            : "Failed to poll research run.",
        )
      }
    }, 2500)

    return () => window.clearInterval(intervalId)
  }, [isPolling, run?.id, setRun])

  const resumeRun = useCallback(async () => {
    if (!run?.id) {
      return
    }

    setSubmitting(true)
    setSubmissionAction("resume")
    setError(null)

    try {
      const response = await fetch(
        `/api/deep-research/runs/${run.id}/resume`,
        run.status === "needs_clarification"
          ? {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                clarificationResponse,
              }),
            }
          : {
              method: "POST",
            },
      )

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to resume research run.")
      }

      setRun(payload)
    } catch (resumeError) {
      setError(
        resumeError instanceof Error
          ? resumeError.message
          : "Failed to resume research run.",
      )
    } finally {
      setSubmitting(false)
      setSubmissionAction(null)
    }
  }, [clarificationResponse, run?.id, run?.status, setRun])

  const retryRun = useCallback(async () => {
    if (!run?.id) {
      return
    }

    setSubmitting(true)
    setSubmissionAction("retry")
    setError(null)

    try {
      const response = await fetch(`/api/deep-research/runs/${run.id}/retry`, {
        method: "POST",
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to retry research run.")
      }

      setRun(payload)
    } catch (retryError) {
      setError(
        retryError instanceof Error
          ? retryError.message
          : "Failed to retry research run.",
      )
    } finally {
      setSubmitting(false)
      setSubmissionAction(null)
    }
  }, [run?.id, setRun])

  return {
    activeRateLimitRetry,
    citedSources,
    clarificationResponse,
    error,
    preResearchPlan,
    resumeRun,
    retryRun,
    run,
    setClarificationResponse,
    setError,
    setRun,
    submissionAction,
    submitting,
  }
}

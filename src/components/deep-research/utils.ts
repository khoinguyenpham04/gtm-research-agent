import type {
  DeepResearchRunEvent,
  DeepResearchRunResponse,
  PreResearchPlan,
  SessionComposerMode,
} from "@/lib/deep-research/types"

export type DeepResearchSourceLink = {
  label: string
  url: string
}

export type DeepResearchRateLimitRetry = {
  attempt: number
  maxAttempts: number
  delayMs: number
  role?: string
}

export function extractSourcesFromReport(
  markdown?: string,
): DeepResearchSourceLink[] {
  if (!markdown) {
    return []
  }

  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g
  const sources = new Map<string, DeepResearchSourceLink>()

  for (const match of markdown.matchAll(linkPattern)) {
    const [, label, url] = match
    if (!sources.has(url)) {
      sources.set(url, { label, url })
    }
  }

  return Array.from(sources.values())
}

export function formatTimestamp(value: string) {
  if (!value) {
    return "Unknown"
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-GB", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

export function extractPreResearchPlan(
  events: DeepResearchRunEvent[] | undefined,
): PreResearchPlan | null {
  if (!events || events.length === 0) {
    return null
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.eventType !== "pre_research_plan_completed") {
      continue
    }

    const value = event.payload?.preResearchPlan
    if (!value || typeof value !== "object") {
      continue
    }

    const candidate = value as Partial<PreResearchPlan>
    if (
      (candidate.mode === "gtm" ||
        candidate.mode === "general" ||
        candidate.mode === "other") &&
      isStringArray(candidate.coreQuestions) &&
      isStringArray(candidate.requiredEvidenceCategories) &&
      isStringArray(candidate.gtmSubquestions) &&
      isStringArray(candidate.documentResearchPriorities)
    ) {
      return candidate as PreResearchPlan
    }
  }

  return null
}

export function extractActiveRateLimitRetry(
  run: DeepResearchRunResponse | null,
): DeepResearchRateLimitRetry | null {
  if (!run || (run.status !== "queued" && run.status !== "running")) {
    return null
  }

  const latestEvent = run.events.at(-1)
  if (latestEvent?.eventType !== "rate_limit_retry_scheduled") {
    return null
  }

  const { attempt, maxAttempts, delayMs, role } = latestEvent.payload ?? {}
  if (
    typeof attempt !== "number" ||
    typeof maxAttempts !== "number" ||
    typeof delayMs !== "number"
  ) {
    return null
  }

  return {
    attempt,
    maxAttempts,
    delayMs,
    role: typeof role === "string" ? role : undefined,
  }
}

export function buildSessionThreadHref({
  autostart,
  mode,
  prompt,
  runId,
  selectedDocumentIds,
  sessionId,
}: {
  sessionId: string
  autostart?: boolean
  mode?: SessionComposerMode
  prompt?: string
  runId?: string
  selectedDocumentIds?: string[]
}) {
  const trimmedSessionId = sessionId.trim()
  if (!trimmedSessionId) {
    return "/dashboard"
  }

  const searchParams = new URLSearchParams()
  const trimmedRunId = runId?.trim()
  if (trimmedRunId) {
    searchParams.set("runId", trimmedRunId)
  }

  if (mode) {
    searchParams.set("mode", mode)
  }

  if (autostart) {
    searchParams.set("autostart", "1")
  }

  const trimmedPrompt = prompt?.trim()
  if (trimmedPrompt) {
    searchParams.set("prompt", trimmedPrompt)
  }

  if (selectedDocumentIds && selectedDocumentIds.length > 0) {
    searchParams.set(
      "selected",
      selectedDocumentIds
        .map((documentId) => documentId.trim())
        .filter(Boolean)
        .join(","),
    )
  }

  return searchParams.size
    ? `/dashboard/chat/sessions/${trimmedSessionId}?${searchParams.toString()}`
    : `/dashboard/chat/sessions/${trimmedSessionId}`
}

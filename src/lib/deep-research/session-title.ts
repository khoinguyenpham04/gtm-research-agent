const DEFAULT_SESSION_TITLE = "New session"
const SESSION_TITLE_MAX_LENGTH = 72

export function buildSessionTitleFromPrompt(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (!normalized) {
    return DEFAULT_SESSION_TITLE
  }

  if (normalized.length <= SESSION_TITLE_MAX_LENGTH) {
    return normalized
  }

  const truncated = normalized.slice(0, SESSION_TITLE_MAX_LENGTH - 1)
  const lastWordBoundary = truncated.lastIndexOf(" ")
  const safeTitle =
    lastWordBoundary >= SESSION_TITLE_MAX_LENGTH * 0.55
      ? truncated.slice(0, lastWordBoundary)
      : truncated

  return `${safeTitle.trim()}…`
}

export function isProvisionalSessionTitle(title?: string | null) {
  return (title ?? "").trim().toLowerCase() === DEFAULT_SESSION_TITLE.toLowerCase()
}

export { DEFAULT_SESSION_TITLE }

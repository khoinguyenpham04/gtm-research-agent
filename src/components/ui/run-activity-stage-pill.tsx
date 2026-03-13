import {
  AlertCircleIcon,
  BubbleChatQuestionIcon,
  Clock01Icon,
  CloudLoadingIcon,
  DatabaseSync01Icon,
  DocumentValidationIcon,
  FileEditIcon,
  FolderLibraryIcon,
  Search01Icon,
  Task01Icon,
  Telescope01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cva } from "class-variance-authority"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const runActivityStageVariants = cva(
  "rounded-full border-0 font-medium shadow-none",
  {
    variants: {
      stage: {
        queued:
          "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-200",
        running:
          "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200",
        completed:
          "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
        clarify:
          "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200",
        planning:
          "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200",
        validation:
          "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
        retrieving:
          "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-200",
        searching:
          "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200",
        researching:
          "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200",
        drafting:
          "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/20 dark:text-fuchsia-200",
        throttled:
          "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200",
        starting:
          "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-200",
        streaming:
          "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200",
        error:
          "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200",
        unknown:
          "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-200",
      },
    },
  },
)

type KnownRunActivityStage =
  | "queued"
  | "running"
  | "completed"
  | "clarify"
  | "planning"
  | "validation"
  | "retrieving"
  | "searching"
  | "researching"
  | "drafting"
  | "starting"
  | "streaming"
  | "error"
  | "throttled"

function normalizeStage(stage: string): KnownRunActivityStage | "unknown" {
  switch (stage) {
    case "queued":
    case "running":
    case "completed":
    case "clarify":
    case "planning":
    case "validation":
    case "retrieving":
    case "searching":
    case "researching":
    case "drafting":
    case "starting":
    case "streaming":
    case "error":
    case "throttled":
      return stage
    default:
      return "unknown"
  }
}

function getStageIcon(stage: KnownRunActivityStage | "unknown") {
  switch (stage) {
    case "queued":
      return Clock01Icon
    case "starting":
      return Clock01Icon
    case "running":
      return CloudLoadingIcon
    case "streaming":
      return CloudLoadingIcon
    case "completed":
      return Task01Icon
    case "clarify":
      return BubbleChatQuestionIcon
    case "planning":
      return Task01Icon
    case "validation":
      return DocumentValidationIcon
    case "retrieving":
      return FolderLibraryIcon
    case "searching":
      return Search01Icon
    case "researching":
      return Telescope01Icon
    case "drafting":
      return FileEditIcon
    case "throttled":
      return AlertCircleIcon
    case "error":
      return AlertCircleIcon
    case "unknown":
    default:
      return DatabaseSync01Icon
  }
}

function formatStageLabel(stage: string) {
  return stage
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export function RunActivityStagePill({
  className,
  label,
  stage,
}: {
  stage: string
  label?: string
  className?: string
}) {
  const normalizedStage = normalizeStage(stage)
  const icon = getStageIcon(normalizedStage)

  return (
    <Badge
      className={cn(
        "h-6 rounded-full border-0 px-3 text-xs font-medium shadow-none",
        runActivityStageVariants({ stage: normalizedStage }),
        className,
      )}
      variant="secondary"
    >
      <HugeiconsIcon
        aria-hidden="true"
        className="shrink-0"
        color="currentColor"
        icon={icon}
        size={12}
        strokeWidth={1.8}
      />
      {label ?? formatStageLabel(stage)}
    </Badge>
  )
}

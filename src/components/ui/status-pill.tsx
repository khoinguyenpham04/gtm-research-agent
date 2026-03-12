import {
  BubbleChatQuestionIcon,
  CancelCircleIcon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  ClockAlertIcon,
  CloudLoadingIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cva, type VariantProps } from "class-variance-authority"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type OperationalStatus =
  | "queued"
  | "running"
  | "needs_clarification"
  | "completed"
  | "failed"
  | "timed_out"
  | "ready"
  | "processing"
  | "pending"

const statusPillVariants = cva("rounded-full border-0 font-medium shadow-none", {
  variants: {
    status: {
      queued:
        "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-200",
      pending:
        "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-200",
      running:
        "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200",
      processing:
        "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200",
      needs_clarification:
        "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200",
      completed:
        "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
      ready:
        "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
      failed:
        "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200",
      timed_out:
        "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200",
    },
    size: {
      sm: "h-5 px-2.5 text-[11px]",
      md: "h-6 px-3 text-xs",
    },
  },
  defaultVariants: {
    size: "sm",
  },
})

function formatStatusLabel(status: OperationalStatus) {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function getStatusIcon(status: OperationalStatus) {
  switch (status) {
    case "completed":
    case "ready":
      return CheckmarkCircle01Icon
    case "running":
    case "processing":
      return CloudLoadingIcon
    case "needs_clarification":
      return BubbleChatQuestionIcon
    case "failed":
      return CancelCircleIcon
    case "timed_out":
      return ClockAlertIcon
    case "queued":
    case "pending":
    default:
      return Clock01Icon
  }
}

export function StatusPill({
  className,
  label,
  size,
  status,
}: {
  status: OperationalStatus
  label?: string
  size?: VariantProps<typeof statusPillVariants>["size"]
  className?: string
}) {
  const icon = getStatusIcon(status)

  return (
    <Badge
      className={cn(statusPillVariants({ status, size }), className)}
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
      {label ?? formatStatusLabel(status)}
    </Badge>
  )
}

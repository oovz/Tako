import {
  ArrowUp,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/src/shared/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { QueueTaskSummary } from "@/src/domain/queue/state"
import { t } from "@/src/runtime/i18n"
import {
  getTaskActionPlan,
  type CommandCenterTaskActionId,
} from "./command-center-queue-helpers"

interface CommandCenterTaskActionsProps {
  taskId: string
  status: QueueTaskSummary["status"]
  isCanceling: boolean
  isForgettingUnobservable?: boolean
  isRetrying?: boolean
  isRestarting?: boolean
  isRemoving?: boolean
  isMoving?: boolean
  canCancel: boolean
  canForgetUnobservable: boolean
  canRetryFailed: boolean
  canRestart: boolean
  canMoveToTop: boolean
  canRemove: boolean
  onBeginCancel: (taskId: string) => void
  onBeginForgetUnobservable?: (taskId: string) => void
  onRetryFailed?: (taskId: string) => void
  onRestartTask?: (taskId: string) => void
  onMoveTaskToTop?: (taskId: string) => void
  onRemoveTask?: (taskId: string) => void
}

function actionLabel(action: CommandCenterTaskActionId): string {
  switch (action) {
    case "cancel":
      return t("sidepanel_cancelDownload")
    case "forget-unobservable":
      return t("sidepanel_forgetDownload")
    case "retry-failed":
      return t("sidepanel_retryFailedChapters")
    case "restart":
      return t("sidepanel_restartAllChapters")
    case "move-to-top":
      return t("sidepanel_moveTaskToTop")
    case "remove":
      return t("common_remove")
  }
}

function actionIcon(action: CommandCenterTaskActionId) {
  switch (action) {
    case "cancel":
      return <XCircle aria-hidden="true" data-icon="inline-start" />
    case "forget-unobservable":
      return <XCircle aria-hidden="true" data-icon="inline-start" />
    case "retry-failed":
    case "restart":
      return <RotateCcw aria-hidden="true" data-icon="inline-start" />
    case "move-to-top":
      return <ArrowUp aria-hidden="true" data-icon="inline-start" />
    case "remove":
      return <Trash2 aria-hidden="true" data-icon="inline-start" />
  }
}

export function CommandCenterTaskActions({
  taskId,
  status,
  isCanceling,
  isForgettingUnobservable = false,
  isRetrying = false,
  isRestarting = false,
  isRemoving = false,
  isMoving = false,
  canCancel,
  canForgetUnobservable,
  canRetryFailed,
  canRestart,
  canMoveToTop,
  canRemove,
  onBeginCancel,
  onBeginForgetUnobservable,
  onRetryFailed,
  onRestartTask,
  onMoveTaskToTop,
  onRemoveTask,
}: CommandCenterTaskActionsProps) {
  const plan = getTaskActionPlan(status, {
    canCancel,
    canForgetUnobservable,
    canRetryFailed,
    canRestart,
    canMoveToTop,
    canRemove,
  })

  const isPending = (action: CommandCenterTaskActionId): boolean =>
    (action === "cancel" && isCanceling) ||
    (action === "forget-unobservable" && isForgettingUnobservable) ||
    (action === "retry-failed" && isRetrying) ||
    (action === "restart" && isRestarting) ||
    (action === "remove" && isRemoving) ||
    (action === "move-to-top" && isMoving)

  const invoke = (action: CommandCenterTaskActionId) => {
    switch (action) {
      case "cancel":
        onBeginCancel(taskId)
        break
      case "forget-unobservable":
        onBeginForgetUnobservable?.(taskId)
        break
      case "retry-failed":
        onRetryFailed?.(taskId)
        break
      case "restart":
        onRestartTask?.(taskId)
        break
      case "move-to-top":
        onMoveTaskToTop?.(taskId)
        break
      case "remove":
        onRemoveTask?.(taskId)
        break
    }
  }

  const renderInlineAction = (action: CommandCenterTaskActionId) => {
    const pending = isPending(action)
    const isDestructive =
      action === "cancel" ||
      action === "forget-unobservable" ||
      action === "remove"

    return (
      <Tooltip key={action}>
        <TooltipTrigger asChild>
          <Button
            aria-label={
              pending && action === "cancel"
                ? t("sidepanel_cancelingDownload")
                : actionLabel(action)
            }
            variant="ghost"
            size="icon"
            className={cn(
              "size-6 rounded transition-all duration-150 active:scale-90",
              isDestructive
                ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            onClick={() => invoke(action)}
            disabled={pending}
          >
            {pending ? (
              <Loader2
                aria-hidden="true"
                data-icon="inline-start"
                className="size-3.5 animate-spin"
              />
            ) : (
              actionIcon(action)
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-xs">
          {actionLabel(action)}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {plan.inline.map(renderInlineAction)}
      {plan.overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={t("sidepanel_moreActions")}
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-150 active:scale-90"
            >
              <MoreHorizontal
                aria-hidden="true"
                data-icon="inline-start"
                className="size-3.5"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {plan.overflow.map((action) => (
              <DropdownMenuItem
                key={action}
                disabled={isPending(action)}
                className={
                  action === "cancel" ||
                  action === "forget-unobservable" ||
                  action === "remove"
                    ? "text-destructive focus:text-destructive"
                    : undefined
                }
                onSelect={() => invoke(action)}
              >
                {isPending(action) ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : (
                  actionIcon(action)
                )}
                {actionLabel(action)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

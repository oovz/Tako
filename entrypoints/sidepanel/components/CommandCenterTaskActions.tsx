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
  type CommandCenterTaskActionHandler,
} from "./command-center-queue-helpers"

interface CommandCenterTaskActionsProps {
  presentation?: "icons" | "recovery"
  taskId: string
  status: QueueTaskSummary["status"]
  outputUncertain?: boolean
  isCanceling: boolean
  isRetrying?: boolean
  isRestarting?: boolean
  isRemoving?: boolean
  isMoving?: boolean
  canCancel: boolean
  canRetryFailed: boolean
  canRestart: boolean
  canMoveToTop: boolean
  canRemove: boolean
  onBeginCancel: (taskId: string) => void
  onRetryFailed?: CommandCenterTaskActionHandler
  onRestartTask?: CommandCenterTaskActionHandler
  onMoveTaskToTop?: CommandCenterTaskActionHandler
  onRemoveTask?: CommandCenterTaskActionHandler
}

interface TaskActionDescriptor {
  id: CommandCenterTaskActionId
  label: string
  pending: boolean | undefined
  destructive: boolean
  Icon: typeof XCircle
  invoke: () => void | Promise<void>
}

const ACTION_PRESENTATION = {
  cancel: {
    labelKey: "sidepanel_cancelDownload",
    Icon: XCircle,
    destructive: true,
  },
  "retry-failed": {
    labelKey: "sidepanel_retryFailedChapters",
    Icon: RotateCcw,
    destructive: false,
  },
  restart: {
    labelKey: "sidepanel_restartAllChapters",
    Icon: RotateCcw,
    destructive: false,
  },
  "move-to-top": {
    labelKey: "sidepanel_moveTaskToTop",
    Icon: ArrowUp,
    destructive: false,
  },
  remove: { labelKey: "common_remove", Icon: Trash2, destructive: true },
} satisfies Record<
  CommandCenterTaskActionId,
  { labelKey: string; Icon: typeof XCircle; destructive: boolean }
>

function actionLabel(
  action: CommandCenterTaskActionId,
  outputUncertain: boolean | undefined
): string {
  if (outputUncertain) {
    if (action === "retry-failed") return t("sidepanel_retryUncertainHandoff")
    if (action === "restart") return t("sidepanel_restartUncertainHandoff")
  }
  return t(ACTION_PRESENTATION[action].labelKey)
}

function getTaskActionDescriptor(
  action: CommandCenterTaskActionId,
  props: CommandCenterTaskActionsProps
): TaskActionDescriptor {
  const controls = {
    cancel: { pending: props.isCanceling, handler: props.onBeginCancel },
    "retry-failed": { pending: props.isRetrying, handler: props.onRetryFailed },
    restart: { pending: props.isRestarting, handler: props.onRestartTask },
    "move-to-top": { pending: props.isMoving, handler: props.onMoveTaskToTop },
    remove: { pending: props.isRemoving, handler: props.onRemoveTask },
  }[action]
  return {
    id: action,
    label:
      props.presentation === "recovery"
        ? t(
            action === "retry-failed"
              ? "sidepanel_retryRemaining"
              : action === "restart"
                ? "sidepanel_restartTask"
                : "common_dismiss"
          )
        : actionLabel(action, props.outputUncertain),
    pending: controls.pending,
    ...ACTION_PRESENTATION[action],
    invoke: () => controls.handler?.(props.taskId),
  }
}

function TaskActionIcon({
  action,
  inline = false,
}: {
  action: TaskActionDescriptor
  inline?: boolean
}) {
  if (action.pending) {
    return (
      <Loader2
        aria-hidden="true"
        data-icon={inline ? "inline-start" : undefined}
        className={cn("animate-spin", inline && "size-3.5")}
      />
    )
  }
  return <action.Icon aria-hidden="true" data-icon="inline-start" />
}

function InlineTaskAction({ action }: { action: TaskActionDescriptor }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={
            action.pending && action.id === "cancel"
              ? t("sidepanel_cancelingDownload")
              : action.label
          }
          variant="ghost"
          size="icon"
          className={cn(
            "size-6 rounded transition-[color,background-color,scale] duration-150 active:scale-90",
            action.destructive
              ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
          onClick={action.invoke}
          disabled={action.pending}
        >
          <TaskActionIcon action={action} inline />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left" className="text-xs">
        {action.label}
      </TooltipContent>
    </Tooltip>
  )
}

function OverflowTaskActions({ actions }: { actions: TaskActionDescriptor[] }) {
  if (actions.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("sidepanel_moreActions")}
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:bg-muted hover:text-foreground transition-[color,background-color,scale] duration-150 active:scale-90"
        >
          <MoreHorizontal
            aria-hidden="true"
            data-icon="inline-start"
            className="size-3.5"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.id}
            disabled={action.pending}
            className={
              action.destructive
                ? "text-destructive focus:text-destructive"
                : undefined
            }
            onSelect={action.invoke}
          >
            <TaskActionIcon action={action} />
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function CommandCenterTaskActions(props: CommandCenterTaskActionsProps) {
  const plan = getTaskActionPlan(props.status, props)
  if (props.presentation === "recovery")
    return (
      <div className="recovery-actions">
        {plan.inline.map((id) => {
          const action = getTaskActionDescriptor(id, props)
          return (
            <button
              type="button"
              key={id}
              aria-label={action.label}
              className={id === "remove" ? "quiet-recovery" : undefined}
              disabled={action.pending}
              onClick={action.invoke}
            >
              {action.label}
            </button>
          )
        })}
        <OverflowTaskActions
          actions={plan.overflow.map((action) =>
            getTaskActionDescriptor(action, props)
          )}
        />
      </div>
    )
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {plan.inline.map((action) => (
        <InlineTaskAction
          key={action}
          action={getTaskActionDescriptor(action, props)}
        />
      ))}
      <OverflowTaskActions
        actions={plan.overflow.map((action) =>
          getTaskActionDescriptor(action, props)
        )}
      />
    </div>
  )
}

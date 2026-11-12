import React, { useState, type Dispatch, type SetStateAction } from "react"
import type { ActiveTaskProgress as ActiveTaskProgressState } from "@/entrypoints/sidepanel/hooks/useActiveTaskProgress"
import { CommandCenterTaskRow } from "@/entrypoints/sidepanel/components/CommandCenterTaskRow"
import type { QueueTaskSummary } from "@/src/domain/queue/state"
import { t } from "@/src/runtime/i18n"
import {
  shouldConfirmTaskCancellation,
  type CommandCenterTaskActionHandler,
} from "@/entrypoints/sidepanel/components/command-center-queue-helpers"
import type { CancelTaskResult } from "@/entrypoints/sidepanel/types"

export interface CommandCenterQueueProps {
  tasks: QueueTaskSummary[]
  lane?: "active" | "waiting"
  taskActionErrors?: Readonly<Record<string, string>>
  onCancelTask?: (
    taskId: string
  ) => CancelTaskResult | Promise<CancelTaskResult>
  cancelingTaskIds?: Set<string>
  retryingTaskIds?: Set<string>
  restartingTaskIds?: Set<string>
  removingTaskIds?: Set<string>
  movingTaskIds?: Set<string>
  onRetryFailed?: CommandCenterTaskActionHandler
  onRestartTask?: CommandCenterTaskActionHandler
  onMoveTaskToTop?: CommandCenterTaskActionHandler
  onRemoveTask?: CommandCenterTaskActionHandler
  emptyState?: React.ReactNode
  activeTaskProgress?: ActiveTaskProgressState | null
  showActiveProgress?: boolean
  queuedTaskIds?: string[]
  onReorder?: (taskId: string, position: number) => void | Promise<void>
  firstQueuedTaskId?: string
}

export { getRetryAvailability } from "@/entrypoints/sidepanel/components/command-center-queue-helpers"

type CancelErrors = Record<string, string>
type StateSetter<T> = Dispatch<SetStateAction<T>>

function clearCancelError(errors: CancelErrors, taskId: string): CancelErrors {
  if (!Object.hasOwn(errors, taskId)) return errors
  const nextErrors = { ...errors }
  delete nextErrors[taskId]
  return nextErrors
}

function getRowError(
  errors: Readonly<Record<string, string>> | undefined,
  taskId: string
): string | undefined {
  return errors && Object.hasOwn(errors, taskId) ? errors[taskId] : undefined
}

function beginTaskCancellation(
  task: QueueTaskSummary,
  onCancelTask: CommandCenterQueueProps["onCancelTask"],
  setConfirming: StateSetter<string | null>,
  setErrors: StateSetter<CancelErrors>
) {
  setErrors((errors) => clearCancelError(errors, task.id))
  if (shouldConfirmTaskCancellation(task)) {
    setConfirming(task.id)
    return
  }
  void Promise.resolve(onCancelTask?.(task.id)).then((result) => {
    if (result?.kind === "failed") {
      setErrors((errors) => ({ ...errors, [task.id]: result.message }))
    }
  })
}

async function confirmTaskCancellation(
  taskId: string,
  onCancelTask: CommandCenterQueueProps["onCancelTask"],
  setConfirming: StateSetter<string | null>,
  setErrors: StateSetter<CancelErrors>
) {
  const result = await onCancelTask?.(taskId)
  if (result?.kind === "failed") {
    setErrors((errors) => ({ ...errors, [taskId]: result.message }))
    return
  }
  if (result?.kind === "already-pending") return
  setErrors((errors) => clearCancelError(errors, taskId))
  setConfirming((currentTaskId) =>
    currentTaskId === taskId ? null : currentTaskId
  )
}

function dismissTaskCancellation(
  taskId: string | null,
  setConfirming: StateSetter<string | null>,
  setErrors: StateSetter<CancelErrors>
) {
  if (taskId) setErrors((errors) => clearCancelError(errors, taskId))
  setConfirming(null)
}

interface QueueCancellation {
  confirmingTaskId: string | null
  errors: CancelErrors
  begin: (task: QueueTaskSummary) => void
  confirm: (taskId: string) => void
  dismiss: () => void
}

function QueueTaskRow({
  task,
  queue,
  cancellation,
}: {
  task: QueueTaskSummary
  queue: CommandCenterQueueProps
  cancellation: QueueCancellation
}) {
  return (
    <div data-queue-task-id={task.id}>
      <CommandCenterTaskRow
        task={task}
        lane={queue.lane}
        queuePosition={
          queue.queuedTaskIds
            ? queue.queuedTaskIds.indexOf(task.id) + 1
            : undefined
        }
        queuedCount={queue.queuedTaskIds?.length}
        onReorder={queue.onReorder}
        isCanceling={queue.cancelingTaskIds?.has(task.id) === true}
        isRetrying={queue.retryingTaskIds?.has(task.id) === true}
        isRestarting={queue.restartingTaskIds?.has(task.id) === true}
        isRemoving={queue.removingTaskIds?.has(task.id) === true}
        isMoving={queue.movingTaskIds?.has(task.id) === true}
        isConfirmingCancel={cancellation.confirmingTaskId === task.id}
        cancelError={getRowError(cancellation.errors, task.id) ?? null}
        taskActionError={getRowError(queue.taskActionErrors, task.id)}
        activeTaskProgress={queue.activeTaskProgress}
        showActiveProgress={queue.showActiveProgress === true}
        isFirstQueuedTask={queue.firstQueuedTaskId === task.id}
        onBeginCancel={() => cancellation.begin(task)}
        onConfirmCancel={cancellation.confirm}
        onDismissCancel={cancellation.dismiss}
        onCancelTask={queue.onCancelTask}
        onRetryFailed={queue.onRetryFailed}
        onRestartTask={queue.onRestartTask}
        onMoveTaskToTop={queue.onMoveTaskToTop}
        onRemoveTask={queue.onRemoveTask}
      />
    </div>
  )
}

export function CommandCenterQueue(props: CommandCenterQueueProps) {
  const [confirmingTaskId, setConfirmingTaskId] = useState<string | null>(null)
  const [cancelErrors, setCancelErrors] = useState<CancelErrors>({})
  const cancellation: QueueCancellation = {
    confirmingTaskId,
    errors: cancelErrors,
    begin: (task) =>
      beginTaskCancellation(
        task,
        props.onCancelTask,
        setConfirmingTaskId,
        setCancelErrors
      ),
    confirm: (taskId) => {
      void confirmTaskCancellation(
        taskId,
        props.onCancelTask,
        setConfirmingTaskId,
        setCancelErrors
      )
    },
    dismiss: () =>
      dismissTaskCancellation(
        confirmingTaskId,
        setConfirmingTaskId,
        setCancelErrors
      ),
  }
  if (props.tasks.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {props.emptyState ?? t("sidepanel_emptyQueue")}
      </div>
    )
  }
  return (
    <div>
      {props.tasks.map((task) => (
        <QueueTaskRow
          key={task.id}
          task={task}
          queue={props}
          cancellation={cancellation}
        />
      ))}
    </div>
  )
}

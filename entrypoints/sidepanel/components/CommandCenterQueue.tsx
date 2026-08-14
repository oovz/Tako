import React, { useState } from "react"
import { toast } from "sonner"

import type { ActiveTaskProgress as ActiveTaskProgressState } from "@/entrypoints/sidepanel/hooks/useActiveTaskProgress"
import { CommandCenterTaskRow } from "@/entrypoints/sidepanel/components/CommandCenterTaskRow"
import type { QueueTaskSummary } from "@/src/domain/queue/state"
import { t } from "@/src/runtime/i18n"
import { shouldConfirmTaskCancellation } from "@/entrypoints/sidepanel/components/command-center-queue-helpers"
import type { CancelTaskResult } from "@/entrypoints/sidepanel/types"

export interface CommandCenterQueueProps {
  tasks: QueueTaskSummary[]
  onCancelTask?: (
    taskId: string
  ) => CancelTaskResult | Promise<CancelTaskResult>
  cancelingTaskIds?: Set<string>
  onForgetUnobservable?: (taskId: string) => void | Promise<void>
  forgettingTaskIds?: Set<string>
  retryingTaskIds?: Set<string>
  restartingTaskIds?: Set<string>
  removingTaskIds?: Set<string>
  movingTaskIds?: Set<string>
  onRetryFailed?: (taskId: string) => void
  onRestartTask?: (taskId: string) => void
  onMoveTaskToTop?: (taskId: string) => void
  onRemoveTask?: (taskId: string) => void
  emptyState?: React.ReactNode
  activeTaskProgress?: ActiveTaskProgressState | null
  showActiveProgress?: boolean
  firstQueuedTaskId?: string
}

export { getRetryAvailability } from "@/entrypoints/sidepanel/components/command-center-queue-helpers"

export function CommandCenterQueue({
  tasks,
  onCancelTask,
  cancelingTaskIds,
  onForgetUnobservable,
  forgettingTaskIds,
  retryingTaskIds,
  restartingTaskIds,
  removingTaskIds,
  movingTaskIds,
  onRetryFailed,
  onRestartTask,
  onMoveTaskToTop,
  onRemoveTask,
  emptyState,
  activeTaskProgress,
  showActiveProgress = false,
  firstQueuedTaskId,
}: CommandCenterQueueProps) {
  const [confirmingCancelTaskId, setConfirmingCancelTaskId] = useState<
    string | null
  >(null)
  const [confirmingForgetTaskId, setConfirmingForgetTaskId] = useState<
    string | null
  >(null)
  const [coverLoadFailures, setCoverLoadFailures] = useState<
    Record<string, true>
  >({})
  const [cancelErrorsByTaskId, setCancelErrorsByTaskId] = useState<
    Record<string, string>
  >({})
  const [forgetErrorsByTaskId, setForgetErrorsByTaskId] = useState<
    Record<string, string>
  >({})

  if (tasks.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {emptyState ?? t("sidepanel_emptyQueue")}
      </div>
    )
  }

  return (
    <div>
      {tasks.map((task) => {
        const isCanceling = cancelingTaskIds?.has(task.id) ?? false

        return (
          <div key={task.id}>
            <CommandCenterTaskRow
              task={task}
              isCanceling={isCanceling}
              isForgettingUnobservable={
                forgettingTaskIds?.has(task.id) ?? false
              }
              isRetrying={retryingTaskIds?.has(task.id) ?? false}
              isRestarting={restartingTaskIds?.has(task.id) ?? false}
              isRemoving={removingTaskIds?.has(task.id) ?? false}
              isMoving={movingTaskIds?.has(task.id) ?? false}
              isConfirmingCancel={confirmingCancelTaskId === task.id}
              isConfirmingForget={confirmingForgetTaskId === task.id}
              cancelError={cancelErrorsByTaskId[task.id] ?? null}
              forgetError={forgetErrorsByTaskId[task.id] ?? null}
              coverFailed={coverLoadFailures[task.id] === true}
              activeTaskProgress={activeTaskProgress}
              showActiveProgress={showActiveProgress}
              isFirstQueuedTask={firstQueuedTaskId === task.id}
              onBeginCancel={(taskId) => {
                setCancelErrorsByTaskId((previousErrors) => {
                  if (!(taskId in previousErrors)) return previousErrors
                  const nextErrors = { ...previousErrors }
                  delete nextErrors[taskId]
                  return nextErrors
                })
                if (!shouldConfirmTaskCancellation(task)) {
                  void Promise.resolve(onCancelTask?.(taskId)).then(
                    (result) => {
                      if (result?.kind === "failed") {
                        toast.error(result.message)
                      }
                    }
                  )
                  return
                }
                setConfirmingCancelTaskId(taskId)
              }}
              onConfirmCancel={(taskId) => {
                void (async () => {
                  const result = await onCancelTask?.(taskId)
                  if (result?.kind === "failed") {
                    setCancelErrorsByTaskId((previousErrors) => ({
                      ...previousErrors,
                      [taskId]: result.message,
                    }))
                    return
                  }

                  if (result?.kind === "already-pending") return

                  setConfirmingCancelTaskId((currentTaskId) =>
                    currentTaskId === taskId ? null : currentTaskId
                  )
                })()
              }}
              onDismissCancel={() => {
                if (confirmingCancelTaskId) {
                  const taskId = confirmingCancelTaskId
                  setCancelErrorsByTaskId((previousErrors) => {
                    if (!(taskId in previousErrors)) return previousErrors
                    const nextErrors = { ...previousErrors }
                    delete nextErrors[taskId]
                    return nextErrors
                  })
                }
                setConfirmingCancelTaskId(null)
              }}
              onBeginForgetUnobservable={(taskId) => {
                setForgetErrorsByTaskId((previousErrors) => {
                  if (!(taskId in previousErrors)) return previousErrors
                  const nextErrors = { ...previousErrors }
                  delete nextErrors[taskId]
                  return nextErrors
                })
                setConfirmingForgetTaskId(taskId)
              }}
              onConfirmForgetUnobservable={(taskId) => {
                void (async () => {
                  try {
                    await onForgetUnobservable?.(taskId)
                  } catch (error) {
                    setForgetErrorsByTaskId((previousErrors) => ({
                      ...previousErrors,
                      [taskId]:
                        error instanceof Error
                          ? error.message
                          : t("sidepanel_toastForgetFailed"),
                    }))
                    return
                  }
                  setConfirmingForgetTaskId((currentTaskId) =>
                    currentTaskId === taskId ? null : currentTaskId
                  )
                })()
              }}
              onDismissForgetUnobservable={() => {
                if (confirmingForgetTaskId) {
                  const taskId = confirmingForgetTaskId
                  setForgetErrorsByTaskId((previousErrors) => {
                    if (!(taskId in previousErrors)) return previousErrors
                    const nextErrors = { ...previousErrors }
                    delete nextErrors[taskId]
                    return nextErrors
                  })
                }
                setConfirmingForgetTaskId(null)
              }}
              onCoverError={(taskId) => {
                setCoverLoadFailures((previousFailures) => ({
                  ...previousFailures,
                  [taskId]: true,
                }))
              }}
              onCancelTask={onCancelTask}
              onForgetUnobservable={onForgetUnobservable}
              onRetryFailed={onRetryFailed}
              onRestartTask={onRestartTask}
              onMoveTaskToTop={onMoveTaskToTop}
              onRemoveTask={onRemoveTask}
            />
          </div>
        )
      })}
    </div>
  )
}

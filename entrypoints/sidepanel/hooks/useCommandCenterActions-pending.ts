import { useCallback, useRef, useState } from "react"
import { createPendingActionGuard } from "./pending-action-guard"

export function usePendingTaskAction<TResult>(
  operation: (taskId: string) => Promise<TResult>,
  alreadyPending: TResult
) {
  const [pendingTaskIds, setPendingTaskIds] = useState(new Set<string>())
  const guardRef = useRef(createPendingActionGuard())

  const run = useCallback(
    async (taskId: string): Promise<TResult> => {
      if (!guardRef.current.tryBegin(taskId)) return alreadyPending
      setPendingTaskIds((previous) => new Set(previous).add(taskId))
      try {
        return await operation(taskId)
      } finally {
        guardRef.current.finish(taskId)
        setPendingTaskIds((previous) => {
          const next = new Set(previous)
          next.delete(taskId)
          return next
        })
      }
    },
    [alreadyPending, operation]
  )

  return { pendingTaskIds, run }
}

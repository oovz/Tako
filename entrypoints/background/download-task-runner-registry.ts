const activeTaskRunners = new Map<string, Promise<void>>()

export function isDownloadTaskRunnerActive(taskId: string): boolean {
  return activeTaskRunners.has(taskId)
}

export async function runDownloadTaskSingleFlight(
  taskId: string,
  operation: () => Promise<void>
): Promise<void> {
  const existing = activeTaskRunners.get(taskId)
  if (existing) return await existing

  const pending = operation()
  activeTaskRunners.set(taskId, pending)
  try {
    await pending
  } finally {
    if (activeTaskRunners.get(taskId) === pending) {
      activeTaskRunners.delete(taskId)
    }
  }
}

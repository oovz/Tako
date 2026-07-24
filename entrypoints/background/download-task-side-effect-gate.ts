const taskSideEffectChains = new Map<string, Promise<void>>()

/**
 * Serialize cancellation and irreversible output handoff for one task within a
 * service-worker lifetime. Durable task/lease checks still fence restarts; this
 * gate closes the local check-to-side-effect race between those writes.
 */
export async function runTaskSideEffectExclusive<T>(
  taskId: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = taskSideEffectChains.get(taskId) ?? Promise.resolve()
  let release!: () => void
  const owned = new Promise<void>((resolve) => {
    release = resolve
  })
  const chain = previous.catch(() => undefined).then(() => owned)
  taskSideEffectChains.set(taskId, chain)

  await previous.catch(() => undefined)
  try {
    return await operation()
  } finally {
    release()
    if (taskSideEffectChains.get(taskId) === chain) {
      taskSideEffectChains.delete(taskId)
    }
  }
}

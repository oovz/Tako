let dispatchPersistenceChain: Promise<void> = Promise.resolve()

/** Serialize storage.local mutations that jointly fence queue and lease state. */
export async function runDispatchPersistenceExclusive<T>(
  operation: () => Promise<T>
): Promise<T> {
  const previous = dispatchPersistenceChain
  let release!: () => void
  const owned = new Promise<void>((resolve) => {
    release = resolve
  })
  dispatchPersistenceChain = previous.catch(() => undefined).then(() => owned)

  await previous.catch(() => undefined)
  try {
    return await operation()
  } finally {
    release()
  }
}

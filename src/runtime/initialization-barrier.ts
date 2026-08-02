export interface InitializationBarrier {
  ensureInitialized: () => Promise<void>
}

export function createInitializationBarrier(input: {
  isInitialized: () => boolean
  initialize: () => Promise<void>
}): InitializationBarrier {
  let initializationPromise: Promise<void> | null = null

  return {
    async ensureInitialized(): Promise<void> {
      if (input.isInitialized()) {
        return
      }

      if (!initializationPromise) {
        initializationPromise = (async () => {
          try {
            await input.initialize()
          } finally {
            // A rejected attempt is not durable service-worker state. The
            // caller observes the failure, while a later event can retry the
            // same initialization after a transient Chrome API/storage error.
            initializationPromise = null
          }
        })()
      }

      await initializationPromise
    },
  }
}

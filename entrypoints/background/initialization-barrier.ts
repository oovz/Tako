export interface InitializationBarrier {
  ensureInitialized: () => Promise<void>
}

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error('Extension initialization failed')

export function createInitializationBarrier(input: {
  isInitialized: () => boolean
  initialize: () => Promise<void>
}): InitializationBarrier {
  let initializationPromise: Promise<void> | null = null
  let initializationError: Error | null = null

  return {
    async ensureInitialized(): Promise<void> {
      if (input.isInitialized()) {
        return
      }

      if (initializationError) {
        throw initializationError
      }

      if (!initializationPromise) {
        initializationPromise = (async () => {
          try {
            await input.initialize()
          } catch (error) {
            initializationError = toError(error)
            throw initializationError
          } finally {
            initializationPromise = null
          }
        })()
      }

      await initializationPromise
    },
  }
}

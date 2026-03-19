import { describe, expect, it, vi } from 'vitest'

import { createInitializationBarrier } from '@/entrypoints/background/initialization-barrier'

describe('createInitializationBarrier', () => {
  it('initializes at most once after success', async () => {
    let initialized = false
    const initialize = vi.fn(async () => {
      initialized = true
    })

    const barrier = createInitializationBarrier({
      isInitialized: () => initialized,
      initialize,
    })

    await barrier.ensureInitialized()
    await barrier.ensureInitialized()

    expect(initialize).toHaveBeenCalledTimes(1)
  })

  it('does not retry initialization after a failure on the next call', async () => {
    const fatalError = new Error('storage corruption')
    let initialized = false
    const initialize = vi.fn(async () => {
      if (initialize.mock.calls.length === 1) {
        throw fatalError
      }

      initialized = true
    })

    const barrier = createInitializationBarrier({
      isInitialized: () => initialized,
      initialize,
    })

    await expect(barrier.ensureInitialized()).rejects.toBe(fatalError)
    await expect(barrier.ensureInitialized()).rejects.toBe(fatalError)

    expect(initialize).toHaveBeenCalledTimes(1)
  })
})


import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/src/runtime/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

async function flushAsyncWork(cycles = 4): Promise<void> {
  for (let i = 0; i < cycles; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('service-worker event promise barrier', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('shares a single initialization barrier across concurrent callers', async () => {
    let resolveAccessLevel: (() => void) | undefined
    const setAccessLevel = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAccessLevel = resolve
        }),
    )

    vi.stubGlobal('chrome', {
      storage: {
        session: {
          setAccessLevel,
        },
      },
    })

    const { waitForInitialization } = await import('@/src/runtime/service-worker-events')
    const firstWait = waitForInitialization()
    const secondWait = waitForInitialization()

    expect(setAccessLevel).toHaveBeenCalledTimes(1)

    await flushAsyncWork()
    expect(resolveAccessLevel).toBeTypeOf('function')
    resolveAccessLevel?.()

    await Promise.all([firstWait, secondWait])
  })

  it('treats session access-level setup failures as non-fatal', async () => {
    const setAccessLevel = vi.fn(async () => {
      throw new Error('boom')
    })

    vi.stubGlobal('chrome', {
      storage: {
        session: {
          setAccessLevel,
        },
      },
    })

    const { waitForInitialization } = await import('@/src/runtime/service-worker-events')

    await expect(waitForInitialization()).resolves.toBeUndefined()
    expect(setAccessLevel).toHaveBeenCalledTimes(1)
  })
})


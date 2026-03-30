import { beforeEach, describe, expect, it, vi } from 'vitest'

function mockRouterDependencies(): void {
  vi.doMock('@/src/runtime/logger', () => ({
    default: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  }))

  vi.doMock('@/src/runtime/external-tab-init', () => ({
    markExternalTabInitialization: vi.fn(async () => undefined),
  }))

  vi.doMock('@/src/site-integrations/url-matcher', () => ({
    matchUrl: vi.fn(() => true),
  }))

  vi.doMock('@/entrypoints/background/action-handlers/tab-state-handlers', () => ({
    handleInitializeTab: vi.fn(async () => ({ success: true })),
    handleClearTabState: vi.fn(async () => ({ success: true })),
  }))

  vi.doMock('@/entrypoints/background/action-handlers/download-task-handlers', () => ({
    handleUpdateDownloadTask: vi.fn(async () => ({ success: true })),
    handleRemoveDownloadTask: vi.fn(async () => ({ success: true })),
    handleCancelDownloadTask: vi.fn(async () => ({ success: true })),
  }))

  vi.doMock('@/entrypoints/background/action-handlers/settings-handlers', () => ({
    handleUpdateSettings: vi.fn(async () => ({ success: true })),
    handleClearDownloadHistory: vi.fn(async () => ({ success: true })),
  }))
}

describe('createStateManager', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns the same initialized manager across repeated calls', async () => {
    const instances: Array<{ initialize: ReturnType<typeof vi.fn> }> = []

    class MockCentralizedStateManager {
      initialize = vi.fn(async () => undefined)

      constructor() {
        instances.push(this)
      }
    }

    mockRouterDependencies()
    vi.doMock('@/src/runtime/centralized-state', () => ({
      CentralizedStateManager: MockCentralizedStateManager,
    }))

    const { createStateManager } = await import('@/entrypoints/background/state-action-router')

    const [first, second, third] = await Promise.all([
      createStateManager(),
      createStateManager(),
      createStateManager(),
    ])

    expect(first).toBe(second)
    expect(second).toBe(third)
    expect(instances).toHaveLength(1)
    expect(instances[0]?.initialize).toHaveBeenCalledTimes(1)
  })

  it('retries initialization after a failed createStateManager call', async () => {
    const instances: Array<{ initialize: ReturnType<typeof vi.fn> }> = []
    let initializeAttempts = 0

    class MockCentralizedStateManager {
      initialize = vi.fn(async () => {
        initializeAttempts += 1
        if (initializeAttempts === 1) {
          throw new Error('initialize failed')
        }
      })

      constructor() {
        instances.push(this)
      }
    }

    mockRouterDependencies()
    vi.doMock('@/src/runtime/centralized-state', () => ({
      CentralizedStateManager: MockCentralizedStateManager,
    }))

    const { createStateManager } = await import('@/entrypoints/background/state-action-router')

    await expect(createStateManager()).rejects.toThrow('initialize failed')

    const recovered = await createStateManager()

    expect(recovered).toBe(instances[1])
    expect(instances).toHaveLength(2)
    expect(instances[0]?.initialize).toHaveBeenCalledTimes(1)
    expect(instances[1]?.initialize).toHaveBeenCalledTimes(1)
  })
})

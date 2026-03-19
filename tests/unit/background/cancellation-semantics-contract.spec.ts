import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleCancelDownloadTask } from '@/entrypoints/background/action-handlers/download-task-handlers'
import type { CentralizedStateManager } from '@/src/runtime/centralized-state'

vi.mock('@/src/runtime/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe('handleCancelDownloadTask', () => {
  const updateDownloadTask = vi.fn(async () => undefined)
  const getGlobalState = vi.fn(async () => ({
    settings: {
      advanced: {
        logLevel: 'debug',
      },
    },
  }))
  const sendMessage = vi.fn(async () => undefined)

  const stateManager = {
    updateDownloadTask,
    getGlobalState,
  } as unknown as CentralizedStateManager

  beforeEach(() => {
    vi.clearAllMocks()

    ;(globalThis as unknown as { chrome: typeof chrome }).chrome = {
      runtime: {
        sendMessage,
      },
    } as unknown as typeof chrome
  })

  it('marks task canceled and sends offscreen cancellation signals', async () => {
    const result = await handleCancelDownloadTask(stateManager, { taskId: 'task-123' })

    expect(result).toEqual({ success: true })
    expect(updateDownloadTask).toHaveBeenCalledWith(
      'task-123',
      expect.objectContaining({
        status: 'canceled',
        completed: expect.any(Number),
      }),
    )

    expect(sendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'OFFSCREEN_CONTROL',
        payload: {
          taskId: 'task-123',
          action: 'cancel',
        },
      }),
    )
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('returns success even if offscreen messaging fails', async () => {
    sendMessage.mockRejectedValueOnce(new Error('offscreen unavailable'))

    const result = await handleCancelDownloadTask(stateManager, { taskId: 'task-123' })

    expect(result).toEqual({ success: true })
    expect(updateDownloadTask).toHaveBeenCalledWith(
      'task-123',
      expect.objectContaining({ status: 'canceled' }),
    )
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })
})


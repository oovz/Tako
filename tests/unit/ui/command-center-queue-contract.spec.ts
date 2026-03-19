import { describe, expect, it } from 'vitest'

import { getRetryAvailability } from '@/entrypoints/sidepanel/components/CommandCenterQueue'
import type { QueueTaskSummary } from '@/src/types/queue-state'

function makeTask(overrides: Partial<QueueTaskSummary>): QueueTaskSummary {
  return {
    id: 'task-1',
    seriesKey: 'mangadex#manga-1',
    seriesTitle: 'Series 1',
    siteIntegration: 'mangadex',
    status: 'partial_success',
    chapters: { total: 3, completed: 2, unsuccessful: 1 },
    timestamps: { created: Date.now(), completed: Date.now() },
    failureReason: undefined,
    failureCategory: undefined,
    isRetried: false,
    isRetryTask: false,
    lastSuccessfulDownloadId: undefined,
    ...overrides,
  }
}

describe('CommandCenterQueue retry availability policy', () => {
  it('allows retry for partial_success task with failed chapters and retry handler', () => {
    const task = makeTask({ status: 'partial_success', isRetried: false })
    const result = getRetryAvailability(task, true)

    expect(result.canRetryFailed).toBe(true)
    expect(result.retryBlockedMessage).toBeNull()
  })

  it('blocks retry for already retried tasks', () => {
    const task = makeTask({ isRetried: true })
    const result = getRetryAvailability(task, true)

    expect(result.canRetryFailed).toBe(false)
  })

  it('blocks retry when no failed chapters remain', () => {
    const task = makeTask({ chapters: { total: 3, completed: 3, unsuccessful: 0 } })
    const result = getRetryAvailability(task, true)

    expect(result.canRetryFailed).toBe(false)
  })

  it('blocks retry when no retry handler is available', () => {
    const task = makeTask({ status: 'partial_success', isRetried: false })
    const result = getRetryAvailability(task, false)

    expect(result.canRetryFailed).toBe(false)
  })
})


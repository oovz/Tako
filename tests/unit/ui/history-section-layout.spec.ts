import { describe, expect, it, vi } from 'vitest'

import { HistorySection } from '@/entrypoints/sidepanel/components/HistorySection'
import type { QueueTaskSummary } from '@/src/types/queue-state'

function makeHistoryTask(id: string): QueueTaskSummary {
  return {
    id,
    seriesKey: `mangadex#${id}`,
    seriesTitle: `Series ${id}`,
    siteIntegration: 'mangadex',
    status: 'completed',
    chapters: { total: 1, completed: 1, unsuccessful: 0 },
    timestamps: { created: 1, completed: 2 },
    failureReason: undefined,
    failureCategory: undefined,
    isRetried: false,
    isRetryTask: false,
    lastSuccessfulDownloadId: undefined,
  }
}

describe('HistorySection layout', () => {
  it('uses flexible height instead of a fixed recent-history cap', () => {
    const element = HistorySection({
      tasks: [makeHistoryTask('one'), makeHistoryTask('two'), makeHistoryTask('three')],
      isInlineSelectionOpen: false,
      onViewFullHistory: vi.fn(),
      onRetryFailed: vi.fn(),
      onRestartTask: vi.fn(),
      onRemoveTask: vi.fn(),
    })

    expect(element).not.toBeNull()
    expect(element?.props.className).not.toContain('max-h-56')
    expect(element?.props.className).not.toContain('flex-shrink-0')
    expect(element?.props.className).toContain('min-h-0')
    expect(element?.props.className).toContain('overflow-y-auto')
  })
})

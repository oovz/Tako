import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { CommandCenterTaskActions } from '@/entrypoints/sidepanel/components/CommandCenterTaskActions'

describe('CommandCenterTaskActions accessibility', () => {
  it('names the disabled canceling state button', () => {
    const html = renderToStaticMarkup(
      React.createElement(CommandCenterTaskActions, {
        taskId: 'task-1',
        status: 'downloading',
        isRetried: false,
        isCanceling: true,
        canCancel: false,
        canRetryFailed: false,
        canRestart: false,
        canMoveToTop: false,
        canRemove: false,
        onBeginCancel: vi.fn(),
      }),
    )

    expect(html).toContain('aria-label="Canceling download"')
    expect(html).toContain('disabled=""')
  })
})

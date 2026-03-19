import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { useErrorsMock, useInitFailureMock } = vi.hoisted(() => ({
  useErrorsMock: vi.fn(),
  useInitFailureMock: vi.fn(),
}))

vi.mock('@/entrypoints/sidepanel/hooks/useErrors', () => ({
  useErrors: useErrorsMock,
}))

vi.mock('@/entrypoints/sidepanel/hooks/useInitFailure', () => ({
  useInitFailure: useInitFailureMock,
}))

import { ErrorBanner } from '@/entrypoints/sidepanel/components/ErrorBanner'

describe('ErrorBanner', () => {
  beforeEach(() => {
    useErrorsMock.mockReturnValue({
      errors: [],
      acknowledgeError: vi.fn(),
    })
    useInitFailureMock.mockReturnValue({
      initFailed: false,
      error: undefined,
    })
  })

  it('renders nothing when there are no persistent or initialization errors', () => {
    const html = renderToStaticMarkup(React.createElement(ErrorBanner))

    expect(html).toBe('')
  })

  it('renders initialization failure from session state', () => {
    useInitFailureMock.mockReturnValue({
      initFailed: true,
      error: 'storage corruption',
    })

    const html = renderToStaticMarkup(React.createElement(ErrorBanner))

    expect(html).toContain('storage corruption')
    expect(html).toContain('Error')
  })

  it('renders both initialization failure and persistent errors', () => {
    useInitFailureMock.mockReturnValue({
      initFailed: true,
      error: 'Extension initialization failed',
    })
    useErrorsMock.mockReturnValue({
      errors: [
        {
          code: 'FSA_HANDLE_INVALID',
          message: 'Folder access is no longer valid',
          severity: 'error',
          ts: 1,
        },
      ],
      acknowledgeError: vi.fn(),
    })

    const html = renderToStaticMarkup(React.createElement(ErrorBanner))

    expect(html).toContain('Extension initialization failed')
    expect(html).toContain('Folder access is no longer valid')
  })
})


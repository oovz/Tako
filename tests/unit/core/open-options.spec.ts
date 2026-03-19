import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { openOptionsPage } from '@/src/runtime/open-options'

describe('openOptionsPage', () => {
  const sendMessage = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends OPEN_OPTIONS with an empty payload when no page is provided', async () => {
    sendMessage.mockResolvedValue({ success: true })

    await expect(openOptionsPage()).resolves.toBeUndefined()

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'OPEN_OPTIONS',
      payload: {},
    })
  })

  it('sends OPEN_OPTIONS with the requested page target', async () => {
    sendMessage.mockResolvedValue({ success: true })

    await expect(openOptionsPage('downloads')).resolves.toBeUndefined()

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'OPEN_OPTIONS',
      payload: { page: 'downloads' },
    })
  })

  it('throws when the background reports an options navigation failure', async () => {
    sendMessage.mockResolvedValue({ success: false, error: 'boom' })

    await expect(openOptionsPage('debug')).rejects.toThrow('boom')
  })

  it('throws when no response is returned', async () => {
    sendMessage.mockResolvedValue(undefined)

    await expect(openOptionsPage('integrations')).rejects.toThrow('Failed to open options page')
  })
})


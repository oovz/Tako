import type { OpenOptionsMessage, OpenOptionsResponse } from '@/src/types/runtime-command-messages'

export type OptionsPageTarget = NonNullable<OpenOptionsMessage['payload']>['page']

export async function openOptionsPage(page?: OptionsPageTarget): Promise<void> {
  const response = await chrome.runtime.sendMessage<OpenOptionsMessage, OpenOptionsResponse>({
    type: 'OPEN_OPTIONS',
    payload: page ? { page } : {},
  })

  if (!response || response.success === false) {
    throw new Error(response?.error || 'Failed to open options page')
  }
}

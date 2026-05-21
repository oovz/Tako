import logger from '@/src/runtime/logger'

export async function preparePixivDispatchContext(): Promise<Record<string, unknown> | undefined> {
  if (!chrome.cookies?.getAll) {
    return undefined
  }

  try {
    const cookies = await chrome.cookies.getAll({ domain: '.pixiv.net' })
    if (cookies.length === 0) {
      return undefined
    }

    return {
      cookieHeader: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
    }
  } catch (error) {
    logger.debug('[pixiv-comic] Failed to read cookies for dispatch context (non-fatal):', error)
    return undefined
  }
}

import logger from '@/src/runtime/logger'
import { matchUrl } from '@/src/site-integrations/url-matcher'
import { shouldSkipContentScriptEnsure } from '@/entrypoints/background/content-script-ensure'

const CONTENT_SCRIPT_FILE = 'content-scripts/content.js'
const ICON_PATHS = {
  active: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
  inactive: { 16: 'icon/inactive-16.png', 32: 'icon/inactive-32.png', 48: 'icon/inactive-48.png', 128: 'icon/inactive-128.png' },
} as const

export function isInternalUrl(url: string | undefined | null): boolean {
  if (!url) {
    return true
  }

  return (
    url.startsWith('chrome-extension://') ||
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('devtools://') ||
    url.startsWith('blob:') ||
    url.startsWith('data:') ||
    url.startsWith('view-source:') ||
    url.startsWith('file://') ||
    url.startsWith('mailto:') ||
    url.startsWith('tel:') ||
    url.startsWith('javascript:')
  )
}

function shouldHaveContentScript(url: string): boolean {
  try {
    new URL(url)
  } catch {
    return false
  }

  return !!matchUrl(url)
}

async function setActionIcon(tabId: number, variant: 'active' | 'inactive'): Promise<void> {
  const paths = variant === 'active' ? ICON_PATHS.active : ICON_PATHS.inactive
  try {
    await chrome.action.setIcon({ tabId, path: paths })
  } catch {
    if (variant === 'inactive') {
      try {
        await chrome.action.setIcon({ tabId, path: ICON_PATHS.active })
      } catch (error) {
        logger.debug('failed to set icon', error)
      }
    }
  }
}

export function createTabUiCoordinator() {
  const lastContentScriptEnsureAttempt = new Map<number, number>()

  return {
    async ensureContentScriptPresent(
      tabId: number,
      url: string | null | undefined,
      options: { force?: boolean } = {},
    ): Promise<void> {
      if (!url || isInternalUrl(url) || !shouldHaveContentScript(url)) {
        return
      }

      const lastTs = lastContentScriptEnsureAttempt.get(tabId) ?? 0
      const now = Date.now()
      if (shouldSkipContentScriptEnsure({
        lastAttemptTimestamp: lastTs,
        now,
        force: options.force === true,
      })) {
        return
      }
      lastContentScriptEnsureAttempt.set(tabId, now)

      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: [CONTENT_SCRIPT_FILE],
        })
      } catch (error) {
        logger.debug('ensureContentScriptPresent: executeScript failed', error)
      }
    },

    async updateActionForTab(tabId: number, url?: string | null): Promise<void> {
      try {
        const supported = url ? !!matchUrl(url) : false

        if (supported) {
          await chrome.action.enable(tabId)
          await chrome.action.setTitle({ tabId, title: 'TMD: Supported site' })
          await setActionIcon(tabId, 'active')
          return
        }

        await chrome.action.enable(tabId)
        await chrome.action.setTitle({ tabId, title: 'TMD: Unsupported site' })
        await setActionIcon(tabId, 'inactive')
      } catch (error) {
        logger.debug('updateActionForTab noop/error', error)
      }
    },

    async updateSidePanelForTab(tabId: number): Promise<void> {
      try {
        await chrome.sidePanel.setOptions({ tabId, path: 'sidepanel.html', enabled: true })
      } catch (error) {
        logger.debug('Failed to set side panel options (non-fatal):', error)
      }
    },
  }
}


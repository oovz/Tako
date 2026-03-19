import { defineContentScript } from 'wxt/utils/define-content-script'

import logger from '@/src/runtime/logger'
import {
  bootstrapContentScript,
  resolveContentTabId,
  resolveInitializeTabPayload,
  resolvePageReadyHook,
  resolveSeriesDataStrategy,
  scheduleInitialContentInitialization,
} from '@/entrypoints/content/content-helpers'
import { initializeContentScript } from '@/entrypoints/content/content-runtime'
import { getContentScriptExcludeMatches, getContentScriptMatches } from '@/src/site-integrations/url-matcher'
import { settingsService } from '@/src/storage/settings-service'

export {
  bootstrapContentScript,
  resolveContentTabId,
  resolveInitializeTabPayload,
  resolvePageReadyHook,
  resolveSeriesDataStrategy,
  scheduleInitialContentInitialization,
}

export default defineContentScript({
  matches: getContentScriptMatches(),
  excludeMatches: getContentScriptExcludeMatches(),
  cssInjectionMode: 'manual',
  main() {
    (() => {
      void (async () => {
        try {
          logger.debug('content: main starting')
          logger.debug('content: current URL', window.location.href)
          logger.debug('content: document ready state', document.readyState)

          await bootstrapContentScript(
            () => {
              initializeContentScript()
            },
            () => settingsService.getSettings(),
          )
        } catch (error) {
          logger.error('content: fatal error in content script main', error)
        }
      })()
    })()
  },
})


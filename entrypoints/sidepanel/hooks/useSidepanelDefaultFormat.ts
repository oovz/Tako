import { useEffect, useState } from 'react'

import type { FormatDisplay } from '../types'
import { DISPLAY_MAP } from '../constants'
import logger from '@/src/runtime/logger'

const FALLBACK_DEFAULT_FORMAT: FormatDisplay = 'CBZ'

export function useSidepanelDefaultFormat(): FormatDisplay {
  const [defaultFormat, setDefaultFormat] = useState<FormatDisplay>(FALLBACK_DEFAULT_FORMAT)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const { settingsService } = await import('@/src/storage/settings-service')
        const settings = await settingsService.getSettings()
        if (cancelled) {
          return
        }

        setDefaultFormat(DISPLAY_MAP[settings.downloads.defaultFormat])
      } catch (error) {
        logger.debug('[SidePanelContext] Failed to load settings for default format:', error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return defaultFormat
}


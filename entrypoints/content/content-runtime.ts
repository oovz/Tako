import logger from '@/src/runtime/logger'
import { findSiteIntegrationForUrl } from '@/src/runtime/site-integration-registry'
import { sendStateAction } from '@/src/runtime/centralized-state'
import type { SeriesMetadata } from '@/src/types/series-metadata'
import { matchUrl } from '@/src/site-integrations/url-matcher'
import type { SiteIntegration } from '@/src/types/site-integrations'
import { StateAction } from '@/src/types/state-actions'
import type {
  ContentScriptGlobal,
  InitializeTabRawChapter,
  InitializeTabRawVolume,
} from '@/entrypoints/content/content-types'
import {
  normalizeFetchedSeriesData,
  resolveContentTabId,
  resolveInitializeTabPayload,
  resolvePageReadyHook,
  resolveSeriesDataStrategy,
  scheduleInitialContentInitialization,
} from '@/entrypoints/content/content-helpers'

const contentScriptGlobal = globalThis as ContentScriptGlobal

export function initializeContentScript() {
  const existingInstance = contentScriptGlobal.__takoContentScriptInstance
  if (existingInstance && typeof existingInstance.reinitializeMangaState === 'function') {
    logger.debug('content: already running, triggering reinitialize')
    try {
      existingInstance.resetPageHiddenFlag?.()
      existingInstance.reinitializeMangaState().catch((error) => {
        logger.error('content: reinjection reinitialize failed', error)
      })
    } catch (error) {
      logger.error('content: reinjection reinitialize threw', error)
    }
    return
  }

  logger.info('content: content script loading')

  class MangaDownloaderContent {
    private initialized = false
    private tabId: number | null = null
    private activeIntegration: SiteIntegration | null = null
    private activeIntegrationId: string | null = null
    private isInitializing = false
    private isPageHidden = false

    constructor() {
      void this.getTabId()
      logger.info('content: constructor completed')
    }

    private async ensureSiteIntegrationForCurrentUrl(): Promise<boolean> {
      const url = window.location.href
      const matchedUrl = matchUrl(url)
      if (!matchedUrl) {
        this.activeIntegration = null
        this.activeIntegrationId = null
        return false
      }

      const { initializeSiteIntegrations } = await import('@/src/runtime/site-integration-initialization')
      await initializeSiteIntegrations()

      const integrationInfo = findSiteIntegrationForUrl(url)
      if (!integrationInfo?.integration) {
        this.activeIntegration = null
        this.activeIntegrationId = null
        return false
      }

      this.activeIntegration = integrationInfo.integration
      this.activeIntegrationId = integrationInfo.id
      return true
    }

    private async getTabId(): Promise<void> {
      const realId = await resolveContentTabId(() =>
        chrome.runtime.sendMessage({
          type: 'GET_TAB_ID',
        }),
      )

      if (typeof realId === 'number') {
        this.tabId = realId
        logger.debug('content: tab ID obtained', this.tabId)
        return
      }

      logger.warn('content: failed to resolve real tabId; aborting initialization for this page.')
    }

    async initialize(): Promise<void> {
      if (this.initialized || this.isInitializing) return
      this.isInitializing = true
      try {
        logger.info('content: initializing manga downloader')
        if (this.tabId === null) {
          logger.debug('content: waiting for tab ID')
          await this.getTabId()
        }
        if (this.tabId === null) throw new Error('Failed to obtain tab ID')
        if (document.readyState === 'loading') {
          await new Promise<void>((resolve) => {
            document.addEventListener('DOMContentLoaded', () => resolve(), {
              once: true,
            })
          })
        }
        if (!matchUrl(window.location.href)) {
          return
        }

        const hasSiteIntegration = await this.ensureSiteIntegrationForCurrentUrl()
        if (!hasSiteIntegration || !this.activeIntegration) {
          return
        }

        await this.initializeMangaState()
        this.initialized = true
        logger.info('content: manga downloader initialized')
      } catch (error) {
        logger.error('content: failed to initialize manga downloader', error)
      } finally {
        this.isInitializing = false
      }
    }

    private async initializeMangaState(): Promise<void> {
      if (!this.activeIntegration || this.tabId === null) return
      try {
        logger.info('content: extracting manga data')
        logger.debug('content: initializing manga state with site integration')
        logger.debug('content: current URL', window.location.href)
        logger.debug('content: document ready state', document.readyState)
        logger.debug('content: DOM content loaded')
        logger.debug('content: active integration name', this.activeIntegration?.content?.name)
        logger.debug('content: active integration content exists', !!this.activeIntegration?.content)
        logger.debug('content: active integration series exists', !!this.activeIntegration?.content?.series)

        const siteIntegrationId = this.getCurrentIntegrationId()
        await resolvePageReadyHook(this.activeIntegration)?.()

        let rawMangaId: string | null = null
        try {
          rawMangaId = this.activeIntegration.content.series.getSeriesId()
        } catch (error) {
          logger.warn('content: getSeriesId failed', error)
        }

        let chapters: InitializeTabRawChapter[] = []
        let volumes: InitializeTabRawVolume[] = []
        let seriesMetadata: SeriesMetadata | undefined
        let extractionError: unknown

        if (rawMangaId) {
          const seriesDataStrategy = resolveSeriesDataStrategy(this.activeIntegration)

          if (seriesDataStrategy.kind !== 'content-dom') {
            logger.debug('content: using non-DOM series loader', {
              siteIntegrationId,
              strategy: seriesDataStrategy.kind,
            })
            try {
              seriesMetadata = await seriesDataStrategy.fetchSeriesMetadata(rawMangaId)
              logger.debug('content: API metadata', seriesMetadata)
            } catch (error) {
              extractionError ??= error
              logger.warn('content: fetchSeriesMetadata failed', error)
            }
            try {
              const fetchedChapters = await seriesDataStrategy.fetchChapterList(rawMangaId)
              const normalizedSeriesData = normalizeFetchedSeriesData(fetchedChapters)
              chapters = normalizedSeriesData.chapters
              volumes = normalizedSeriesData.volumes
              logger.debug('content: API chapters count', chapters.length)
            } catch (error) {
              extractionError ??= error
              logger.warn('content: fetchChapterList failed', error)
            }
          } else {
            logger.debug('content: using DOM-based site integration', siteIntegrationId)
            try {
              const extractedChapters = this.activeIntegration.content.series.extractChapterList
                ? await this.activeIntegration.content.series.extractChapterList()
                : []
              const normalizedSeriesData = normalizeFetchedSeriesData(extractedChapters)
              chapters = normalizedSeriesData.chapters
              volumes = normalizedSeriesData.volumes
              logger.debug('content: extracted chapters', chapters.length)
              logger.debug('content: extracting series metadata')
              seriesMetadata = this.activeIntegration.content.series.extractSeriesMetadata
                ? await this.activeIntegration.content.series.extractSeriesMetadata()
                : undefined
              logger.debug('content: extracted metadata', seriesMetadata)
            } catch (error) {
              extractionError ??= error
              logger.warn('content: DOM extraction failed', error)
            }
          }
        }

        const initPayload = resolveInitializeTabPayload({
          siteIntegrationId,
          rawMangaId,
          chapters,
          volumes,
          seriesMetadata,
          extractionError,
        })

        logger.debug('content: extraction result', {
          siteIntegrationId,
          rawMangaId,
          initPayload,
          chaptersCount: chapters.length,
          metadata: seriesMetadata,
          extractionError,
        })

        try {
          const lockKey = `tabInitLock_${this.tabId}`
          const lockResult = await chrome.storage.session.get([lockKey])
          const rawLock = lockResult[lockKey] as number | undefined
          const lockTimestamp = typeof rawLock === 'number' ? rawLock : undefined
          if (typeof lockTimestamp === 'number' && Date.now() - lockTimestamp < 30_000) {
            return
          }
        } catch {
          // Intentionally swallow - tab may have closed during initialization
        }

        if (this.isPageHidden) {
          logger.debug('content: page is hidden, skipping INITIALIZE_TAB')
          return
        }

        logger.debug('content: sending INITIALIZE_TAB action', initPayload)

        try {
          logger.debug('content: calling sendStateAction')
          const response = await sendStateAction(
            StateAction.INITIALIZE_TAB,
            initPayload,
          )
          logger.debug('content: sendStateAction response', response)
          logger.info('content: INITIALIZE_TAB action sent')
        } catch (error) {
          logger.error('content: error sending state action', error)
        }
      } catch (error) {
        logger.error('content: failed to initialize manga state', error)
      }
    }

    private getCurrentIntegrationId(): string {
      if (this.activeIntegrationId) return this.activeIntegrationId
      const integrationInfo = findSiteIntegrationForUrl(window.location.href)
      return integrationInfo?.id || 'unknown'
    }

    async reinitializeMangaState(): Promise<void> {
      if (this.isInitializing) return
      this.isInitializing = true
      try {
        if (this.tabId == null) {
          await this.getTabId()
        }
        if (this.tabId == null) {
          logger.warn('content: reinitializeMangaState: no tabId available')
          return
        }

        if (!matchUrl(window.location.href)) {
          return
        }

        if (!this.activeIntegration) {
          const hasSiteIntegration = await this.ensureSiteIntegrationForCurrentUrl()
          if (!hasSiteIntegration || !this.activeIntegration) {
            return
          }
        }

        logger.info('content: reinitializing manga state')
        await this.initializeMangaState()
        this.initialized = true
        logger.info('content: manga state reinitialized')
      } catch (error) {
        logger.error('content: failed to reinitialize manga state after bfcache', error)
      } finally {
        this.isInitializing = false
      }
    }

    cleanup(): void {
      this.isPageHidden = true
      if (this.tabId !== null) {
        logger.debug('content: cleanup sending CLEAR_TAB_STATE for tab', this.tabId)
        void sendStateAction(StateAction.CLEAR_TAB_STATE, undefined).catch((error) =>
          logger.debug('content: CLEAR_TAB_STATE failed (non-fatal)', error),
        )
      }
    }

    markPageHidden(): void {
      this.isPageHidden = true
    }

    resetPageHiddenFlag(): void {
      this.isPageHidden = false
    }
  }

  const mangaDownloader = new MangaDownloaderContent()
  contentScriptGlobal.__takoContentScriptInstance = mangaDownloader

  scheduleInitialContentInitialization(() => mangaDownloader.initialize())

  window.addEventListener('pagehide', () => {
    logger.info('content: page hidden, cleaning up state')
    mangaDownloader.cleanup()
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      mangaDownloader.markPageHidden()
      return
    }

    if (document.visibilityState === 'visible') {
      mangaDownloader.resetPageHiddenFlag()
    }
  })

  window.addEventListener('pageshow', (event: PageTransitionEvent) => {
    if (event.persisted) {
      logger.info('content: page restored from bfcache, reinitializing manga state')
      mangaDownloader.resetPageHiddenFlag()
      mangaDownloader.reinitializeMangaState().catch((error) => {
        logger.error('content: failed to reinitialize after bfcache restoration', error)
      })
    }
  })

  logger.info('content: content script loaded')
}


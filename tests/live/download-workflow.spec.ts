import fs from 'node:fs/promises'
import type { BrowserContext, Page } from '@playwright/test'

import { test, expect } from '../e2e/fixtures/extension'
import { getSessionState, getTabId, waitForGlobalState } from '../e2e/fixtures/state-helpers'
import {
  MANGADEX_TEST_SERIES_URL,
  LIVE_PIXIV_COMIC_REFERENCE_URL,
  LIVE_SHONENJUMPPLUS_REFERENCE_URL,
} from '../e2e/fixtures/test-domains'
import type { DownloadTaskState, GlobalAppState } from '@/src/types/queue-state'
import type { MangaPageState } from '@/src/types/tab-state'
import type { ExtensionSettings } from '@/src/storage/settings-types'

type LiveChapter = {
  id: string
  index: number
  title: string
  url: string
  locked?: boolean
  chapterLabel?: string
  chapterNumber?: number
  volumeLabel?: string
  volumeNumber?: number
  language?: string
}

type LiveDownloadState = Pick<MangaPageState, 'siteIntegrationId' | 'mangaId' | 'seriesTitle' | 'metadata'> & {
  chapters: LiveChapter[]
}

type BrowserWorkflowCase = {
  name: string
  integrationId: string
  url: string
  expectedMangaId?: string
  expectedSeriesTitle?: string
}

type StoredSiteIntegrationSettings = Record<string, Record<string, unknown>>

type DownloadItemSnapshot = {
  id?: number
  filename?: string
  state?: string
  exists?: boolean
}

type SeededDirectoryFile = {
  path: string
  size: number
}

const LIVE_MANGADEX_KEMUTAI_URL = 'https://mangadex.org/title/b28525ae-ef8a-47aa-a120-5917a351be2d/kemutai-hanashi'

const browserWorkflowCases: BrowserWorkflowCase[] = [
  {
    name: 'mangadex kemutai-hanashi',
    integrationId: 'mangadex',
    url: LIVE_MANGADEX_KEMUTAI_URL,
    expectedMangaId: 'b28525ae-ef8a-47aa-a120-5917a351be2d',
    expectedSeriesTitle: 'Kemutai Hanashi',
  },
  {
    name: 'mangadex hunter-x-hunter',
    integrationId: 'mangadex',
    url: MANGADEX_TEST_SERIES_URL,
    expectedMangaId: 'db692d58-4b13-4174-ae8c-30c515c0689c',
    expectedSeriesTitle: 'Hunter x Hunter',
  },
  {
    name: 'pixiv-comic default',
    integrationId: 'pixiv-comic',
    url: LIVE_PIXIV_COMIC_REFERENCE_URL,
  },
  {
    name: 'shonenjumpplus default',
    integrationId: 'shonenjumpplus',
    url: LIVE_SHONENJUMPPLUS_REFERENCE_URL,
  },
]

function isLiveDownloadState(value: unknown, integrationId: string): value is LiveDownloadState {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<LiveDownloadState>
  return candidate.siteIntegrationId === integrationId
    && typeof candidate.mangaId === 'string'
    && candidate.mangaId.length > 0
    && typeof candidate.seriesTitle === 'string'
    && candidate.seriesTitle.length > 0
    && Array.isArray(candidate.chapters)
    && candidate.chapters.some((chapter) => chapter && typeof chapter.url === 'string' && chapter.locked !== true)
}

async function openOptionsPage(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' })
  return page
}

async function seedMangadexWebsitePreferences(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.setItem('md', JSON.stringify({
      settings: {
        dataSaver: false,
        filteredLanguages: ['en'],
      },
    }))
  })
}

async function seedMangadexSessionPreferences(optionsPage: Page, seriesId: string): Promise<void> {
  await optionsPage.evaluate(async (mangaId: string) => {
    const storageKey = 'mangadexUserPreferencesBySeries'
    const current = await chrome.storage.session.get(storageKey) as Record<string, unknown>
    const existing = current[storageKey]
    const bySeries = existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {}

    bySeries[`mangadex#${mangaId}`] = {
      dataSaver: false,
      filteredLanguages: ['en'],
    }

    await chrome.storage.session.set({
      [storageKey]: bySeries,
    })
  }, seriesId)
}

async function resolveCandidateTabIds(optionsPage: Page, preferredTabId: number, targetHref: string): Promise<number[]> {
  return await optionsPage.evaluate(
    async ({ preferredTabId: preferredId, targetHref: href }: { preferredTabId: number; targetHref: string }) => {
      const target = new URL(href)
      const allTabs = await chrome.tabs.query({})

      const matchedIds = allTabs
        .filter((tab) => {
          if (typeof tab.id !== 'number' || !tab.url) {
            return false
          }

          try {
            const url = new URL(tab.url)
            if (url.hostname !== target.hostname) {
              return false
            }

            return url.pathname === target.pathname
              || url.pathname.startsWith(target.pathname)
              || target.pathname.startsWith(url.pathname)
          } catch {
            return false
          }
        })
        .map((tab) => tab.id as number)

      return [preferredId, ...matchedIds].filter(
        (id, index, arr): id is number => typeof id === 'number' && arr.indexOf(id) === index,
      )
    },
    { preferredTabId, targetHref },
  )
}

async function reinjectContentScript(optionsPage: Page, candidateTabIds: number[]): Promise<void> {
  await optionsPage.evaluate(async (ids: number[]) => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    for (const tabId of ids) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content-scripts/content.js'],
          })
          break
        } catch {
          await wait(750)
        }
      }
    }
  }, candidateTabIds)
}

async function loadLiveDownloadState(
  context: BrowserContext,
  extensionId: string,
  page: Page,
  integrationId: string,
  options: { expectedMangaId?: string; expectedSeriesTitle?: string } = {},
): Promise<{ optionsPage: Page; tabId: number; state: LiveDownloadState }> {
  const optionsPage = await openOptionsPage(context, extensionId)
  const preferredTabId = await getTabId(page, context)
  const candidateTabIds = options.expectedMangaId || options.expectedSeriesTitle
    ? [preferredTabId]
    : await resolveCandidateTabIds(optionsPage, preferredTabId, page.url())

  expect(candidateTabIds.length).toBeGreaterThan(0)
  await reinjectContentScript(optionsPage, candidateTabIds)

  const startedAt = Date.now()
  let lastState: unknown
  while (Date.now() - startedAt < 90_000) {
    for (const tabId of candidateTabIds) {
      const state = await getSessionState<unknown>(context, `tab_${tabId}`)
      lastState = state
      if (
        isLiveDownloadState(state, integrationId)
        && (!options.expectedMangaId || state.mangaId === options.expectedMangaId)
        && (!options.expectedSeriesTitle || state.seriesTitle === options.expectedSeriesTitle)
      ) {
        return { optionsPage, tabId, state }
      }
    }
    await page.waitForTimeout(500)
  }

  await optionsPage.close()
  throw new Error(`Timed out waiting for live download state for ${integrationId}. Last state: ${JSON.stringify(lastState)}`)
}

async function persistDownloadSettings(
  optionsPage: Page,
  downloadPatch: Partial<ExtensionSettings['downloads']>,
  siteSettingsPatch?: StoredSiteIntegrationSettings,
): Promise<void> {
  const nextSettings = await optionsPage.evaluate(
    async ({ patch, sitePatch }: { patch: Partial<ExtensionSettings['downloads']>; sitePatch?: StoredSiteIntegrationSettings }) => {
      const current = await chrome.storage.local.get(['settings:global', 'siteIntegrationSettings']) as {
        'settings:global'?: ExtensionSettings
        siteIntegrationSettings?: StoredSiteIntegrationSettings
      }

      const baseSettings = current['settings:global']
      if (!baseSettings) {
        throw new Error('Missing persisted settings payload')
      }

      const mergedSettings: ExtensionSettings = {
        ...baseSettings,
        downloads: {
          ...baseSettings.downloads,
          ...patch,
        },
      }

      const mergedSiteSettings: StoredSiteIntegrationSettings = {
        ...(current.siteIntegrationSettings ?? {}),
        ...(sitePatch ?? {}),
      }

      await chrome.storage.local.set({
        'settings:global': mergedSettings,
        siteIntegrationSettings: mergedSiteSettings,
      })

      await chrome.runtime.sendMessage({
        type: 'SYNC_SETTINGS_TO_STATE',
        payload: {
          settings: mergedSettings,
        },
      })

      return {
        globalSettings: mergedSettings,
        siteIntegrationSettings: mergedSiteSettings,
      }
    },
    { patch: downloadPatch, sitePatch: siteSettingsPatch },
  )

  expect(nextSettings.globalSettings.downloads.defaultFormat).toBe('cbz')
}

async function startSingleChapterDownload(
  optionsPage: Page,
  tabId: number,
  state: LiveDownloadState,
): Promise<{ taskId: string; chapter: LiveChapter }> {
  const downloadableChapters = state.chapters.filter(
    (candidate) => candidate.locked !== true && typeof candidate.url === 'string' && candidate.url.length > 0,
  )
  const chapter = state.siteIntegrationId === 'mangadex'
    ? downloadableChapters.at(-1)
    : downloadableChapters[0]
  if (!chapter) {
    throw new Error(`No downloadable chapter found for ${state.siteIntegrationId}:${state.mangaId}`)
  }

  const response = await optionsPage.evaluate(
    async ({ sourceTabId, mangaState, selectedChapter }: { sourceTabId: number; mangaState: LiveDownloadState; selectedChapter: LiveChapter }) => {
      return await chrome.runtime.sendMessage({
        type: 'START_DOWNLOAD',
        payload: {
          sourceTabId,
          siteIntegrationId: mangaState.siteIntegrationId,
          mangaId: mangaState.mangaId,
          seriesTitle: mangaState.seriesTitle,
          metadata: mangaState.metadata,
          chapters: [
            {
              id: selectedChapter.id,
              title: selectedChapter.title,
              url: selectedChapter.url,
              index: selectedChapter.index,
              chapterLabel: selectedChapter.chapterLabel,
              chapterNumber: selectedChapter.chapterNumber,
              volumeLabel: selectedChapter.volumeLabel,
              volumeNumber: selectedChapter.volumeNumber,
              language: selectedChapter.language,
            },
          ],
        },
      }) as { success?: boolean; taskId?: string; error?: string }
    },
    {
      sourceTabId: tabId,
      mangaState: state,
      selectedChapter: chapter,
    },
  )

  expect(response?.success).toBe(true)
  expect(typeof response?.taskId).toBe('string')

  return {
    taskId: response.taskId as string,
    chapter,
  }
}

async function waitForTerminalTask(context: BrowserContext, taskId: string): Promise<DownloadTaskState> {
  const globalState = await waitForGlobalState(
    context,
    (state: GlobalAppState) => state.downloadQueue.some((task) => task.id === taskId && (
      task.status === 'completed'
      || task.status === 'partial_success'
      || task.status === 'failed'
      || task.status === 'canceled'
    )),
    { timeout: 300_000 },
  )

  const task = globalState.downloadQueue.find((candidate) => candidate.id === taskId)
  if (!task) {
    throw new Error(`Task ${taskId} disappeared before terminal assertion`)
  }

  return task
}

function assertTaskSucceeded(task: DownloadTaskState): void {
  if (task.status === 'completed' || task.status === 'partial_success') {
    return
  }

  throw new Error(`Download task ${task.id} finished with status ${task.status}: ${JSON.stringify({
    errorMessage: task.errorMessage,
    errorCategory: task.errorCategory,
    lastSuccessfulDownloadId: task.lastSuccessfulDownloadId,
    chapters: task.chapters.map((chapter) => ({
      id: chapter.id,
      status: chapter.status,
      errorMessage: chapter.errorMessage,
      imagesFailed: chapter.imagesFailed,
      totalImages: chapter.totalImages,
      title: chapter.title,
    })),
  })}`)
}

async function waitForBrowserDownload(optionsPage: Page, downloadId: number): Promise<DownloadItemSnapshot> {
  const startedAt = Date.now()
  let lastItem: DownloadItemSnapshot | undefined

  while (Date.now() - startedAt < 60_000) {
    const item = await optionsPage.evaluate(async (id: number) => {
      const [downloadItem] = await chrome.downloads.search({ id })
      return downloadItem
        ? {
            id: downloadItem.id,
            filename: downloadItem.filename,
            state: downloadItem.state,
          }
        : undefined
    }, downloadId)

    if (item?.filename) {
      let exists = false
      try {
        await fs.access(item.filename)
        exists = true
      } catch {
        exists = false
      }

      lastItem = {
        ...item,
        exists,
      }

      if (item.state === 'complete' && exists) {
        return lastItem
      }
    }

    await optionsPage.waitForTimeout(500)
  }

  throw new Error(`Timed out waiting for browser download ${downloadId}. Last item: ${JSON.stringify(lastItem)}`)
}

async function expectZipArchiveFile(filePath: string | undefined): Promise<void> {
  expect(typeof filePath).toBe('string')
  const handle = await fs.open(filePath as string, 'r')

  try {
    const signature = Buffer.alloc(4)
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0)
    expect(bytesRead).toBe(4)
    expect(signature.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true)
  } finally {
    await handle.close()
  }
}

async function seedCustomDirectoryHandle(optionsPage: Page): Promise<string> {
  return await optionsPage.evaluate(async () => {
    const directoryName = `live-downloads-${Date.now()}`
    const opfsRoot = await navigator.storage.getDirectory()
    const seededDirectory = await opfsRoot.getDirectoryHandle(directoryName, { create: true })

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('tako-fs', 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles')
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Failed to open tako-fs IndexedDB'))
    })

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('handles', 'readwrite')
      const store = transaction.objectStore('handles')
      store.put(seededDirectory, 'download-root')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Failed to seed download-root handle'))
    })

    return directoryName
  })
}

async function listSeededDirectoryFiles(optionsPage: Page, directoryName: string): Promise<SeededDirectoryFile[]> {
  return await optionsPage.evaluate(async (name: string) => {
    const opfsRoot = await navigator.storage.getDirectory()
    const seededDirectory = await opfsRoot.getDirectoryHandle(name)
    const files: SeededDirectoryFile[] = []

    const walk = async (directory: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const [entryName, entryHandle] of directory.entries()) {
        const nextPath = prefix.length > 0 ? `${prefix}/${entryName}` : entryName
        if (entryHandle.kind === 'directory') {
          await walk(entryHandle as FileSystemDirectoryHandle, nextPath)
          continue
        }

        const file = await (entryHandle as FileSystemFileHandle).getFile()
        files.push({ path: nextPath, size: file.size })
      }
    }

    await walk(seededDirectory, '')
    return files
  }, directoryName)
}

test.describe('Live download workflows', () => {
  test.describe.configure({ timeout: 360_000 })

  for (const workflowCase of browserWorkflowCases) {
    test(`completes a browser-mode live single-chapter download for ${workflowCase.name}`, async ({ context, extensionId }) => {
      const page = await context.newPage()
      await page.goto(workflowCase.url, { waitUntil: 'domcontentloaded' })

      if (workflowCase.integrationId === 'mangadex') {
        await seedMangadexWebsitePreferences(page)
      }

      const { optionsPage, tabId, state } = await loadLiveDownloadState(
        context,
        extensionId,
        page,
        workflowCase.integrationId,
        {
          expectedMangaId: workflowCase.expectedMangaId,
          expectedSeriesTitle: workflowCase.expectedSeriesTitle,
        },
      )

      if (workflowCase.integrationId === 'mangadex') {
        await seedMangadexSessionPreferences(optionsPage, state.mangaId)
      }

      try {
        await persistDownloadSettings(
          optionsPage,
          {
            downloadMode: 'browser',
            customDirectoryEnabled: false,
            customDirectoryHandleId: null,
            defaultFormat: 'cbz',
            maxConcurrentChapters: 1,
            overwriteExisting: true,
          },
          workflowCase.integrationId === 'mangadex'
            ? {
                mangadex: {
                  autoReadMangaDexSettings: true,
                  imageQuality: 'data',
                },
              }
            : undefined,
        )

        const { taskId } = await startSingleChapterDownload(optionsPage, tabId, state)
        const task = await waitForTerminalTask(context, taskId)

        assertTaskSucceeded(task)
        expect(typeof task.lastSuccessfulDownloadId).toBe('number')

        const downloadItem = await waitForBrowserDownload(optionsPage, task.lastSuccessfulDownloadId as number)
        expect(downloadItem.state).toBe('complete')
        expect(downloadItem.exists).toBe(true)
        await expectZipArchiveFile(downloadItem.filename)
      } finally {
        await optionsPage.close()
        await page.close()
      }
    })
  }

  test('writes a live MangaDex single-chapter download through the custom-folder pipeline', async ({ context, extensionId }) => {
    const page = await context.newPage()
    await page.goto(LIVE_MANGADEX_KEMUTAI_URL, { waitUntil: 'domcontentloaded' })
    await seedMangadexWebsitePreferences(page)

    const { optionsPage, tabId, state } = await loadLiveDownloadState(context, extensionId, page, 'mangadex')
    await seedMangadexSessionPreferences(optionsPage, state.mangaId)

    try {
      const seededDirectoryName = await seedCustomDirectoryHandle(optionsPage)

      await persistDownloadSettings(
        optionsPage,
        {
          downloadMode: 'custom',
          customDirectoryEnabled: true,
          customDirectoryHandleId: 'download-root',
          defaultFormat: 'cbz',
          maxConcurrentChapters: 1,
          overwriteExisting: true,
        },
        {
          mangadex: {
            autoReadMangaDexSettings: true,
            imageQuality: 'data',
          },
        },
      )

      const { taskId } = await startSingleChapterDownload(optionsPage, tabId, state)
      const task = await waitForTerminalTask(context, taskId)

      assertTaskSucceeded(task)
      expect(task.lastSuccessfulDownloadId).toBeUndefined()

      const startedAt = Date.now()
      let files: SeededDirectoryFile[] = []
      while (Date.now() - startedAt < 60_000) {
        files = await listSeededDirectoryFiles(optionsPage, seededDirectoryName)
        if (files.some((file) => file.path.toLowerCase().endsWith('.cbz') && file.size > 0)) {
          break
        }
        await optionsPage.waitForTimeout(500)
      }

      expect(files.some((file) => file.path.toLowerCase().endsWith('.cbz') && file.size > 0)).toBe(true)
    } finally {
      await optionsPage.close()
      await page.close()
    }
  })
})

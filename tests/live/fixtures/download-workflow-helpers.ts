import fs from "node:fs/promises"
import type { BrowserContext, Page } from "@playwright/test"
import { expect } from "@playwright/test"
import {
  focusTab,
  getSessionState,
  getTabId,
  openSidepanelHarness,
} from "../../e2e/fixtures/state-helpers"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import type { MangaPageState } from "@/src/types/tab-state"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import {
  LOCAL_STORAGE_KEYS,
  SESSION_STORAGE_KEYS,
} from "@/src/runtime/storage-keys"
import type { LiveChapter } from "./metadata-extraction-helpers"

export type { LiveChapter }

export type LiveDownloadState = Pick<
  MangaPageState,
  "siteIntegrationId" | "mangaId" | "seriesTitle" | "metadata"
> & {
  chapters: LiveChapter[]
}

export type BrowserWorkflowCase = {
  name: string
  integrationId: string
  url: string
  expectedMangaId?: string
  expectedSeriesTitle?: string
}

export type StoredSiteIntegrationSettings = Record<
  string,
  Record<string, unknown>
>

export type DownloadItemSnapshot = {
  id?: number
  filename?: string
  state?: string
  exists?: boolean
}

export type SeededDirectoryFile = {
  path: string
  size: number
}

const LIVE_TASK_TERMINAL_TIMEOUT_MS = 180_000

export function isLiveDownloadState(
  value: unknown,
  integrationId: string
): value is LiveDownloadState {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Partial<LiveDownloadState>
  return (
    candidate.siteIntegrationId === integrationId &&
    typeof candidate.mangaId === "string" &&
    candidate.mangaId.length > 0 &&
    typeof candidate.seriesTitle === "string" &&
    candidate.seriesTitle.length > 0 &&
    Array.isArray(candidate.chapters) &&
    candidate.chapters.some(
      (chapter) =>
        chapter && typeof chapter.url === "string" && chapter.locked !== true
    )
  )
}

/**
 * Resolve candidate tab IDs for content-script reinjection.
 */
export async function resolveCandidateTabIds(
  optionsPage: Page,
  preferredTabId: number,
  targetHref: string
): Promise<number[]> {
  return await optionsPage.evaluate(
    async ({
      preferredTabId: preferredId,
      targetHref: href,
    }: {
      preferredTabId: number
      targetHref: string
    }) => {
      const target = new URL(href)
      const allTabs = await chrome.tabs.query({})

      const urlMatchedIds = allTabs
        .filter((tab) => {
          if (typeof tab.id !== "number" || !tab.url) {
            return false
          }

          try {
            const url = new URL(tab.url)
            if (url.hostname !== target.hostname) {
              return false
            }

            return (
              url.pathname === target.pathname ||
              url.pathname.startsWith(target.pathname) ||
              target.pathname.startsWith(url.pathname)
            )
          } catch {
            return false
          }
        })
        .map((tab) => tab.id as number)

      return [preferredId, ...urlMatchedIds].filter(
        (id, index, arr): id is number =>
          typeof id === "number" && arr.indexOf(id) === index
      )
    },
    { preferredTabId, targetHref }
  )
}

export async function openOptionsPage(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "domcontentloaded",
  })
  return page
}

export async function seedMangadexWebsitePreferences(
  page: Page
): Promise<void> {
  await page.evaluate(() => {
    localStorage.setItem(
      "md",
      JSON.stringify({
        settings: {
          dataSaver: true,
          filteredLanguages: ["en"],
        },
      })
    )
  })
}

export async function seedMangadexSessionPreferences(
  optionsPage: Page,
  seriesId: string
): Promise<void> {
  await optionsPage.evaluate(async (mangaId: string) => {
    const storageKey = "mangadexUserPreferencesBySeries"
    const current = (await chrome.storage.session.get(storageKey)) as Record<
      string,
      unknown
    >
    const existing = current[storageKey]
    const bySeries =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {}

    bySeries[`mangadex#${mangaId}`] = {
      dataSaver: true,
      filteredLanguages: ["en"],
    }

    await chrome.storage.session.set({
      [storageKey]: bySeries,
    })
  }, seriesId)
}

export async function loadLiveDownloadState(
  context: BrowserContext,
  extensionId: string,
  page: Page,
  integrationId: string,
  options: {
    expectedMangaId?: string
    expectedSeriesTitle?: string
    diagnosticEvents?: string[]
  } = {}
): Promise<{ optionsPage: Page; tabId: number; state: LiveDownloadState }> {
  const optionsPage = await openOptionsPage(context, extensionId)
  const preferredTabId = await getTabId(page, context)
  const candidateTabIds =
    options.expectedMangaId || options.expectedSeriesTitle
      ? [preferredTabId]
      : await resolveCandidateTabIds(optionsPage, preferredTabId, page.url())

  expect(candidateTabIds.length).toBeGreaterThan(0)

  const startedAt = Date.now()
  let lastState: unknown
  while (Date.now() - startedAt < 30_000) {
    for (const tabId of candidateTabIds) {
      const state = await getSessionState<unknown>(context, `tab_${tabId}`)
      lastState = state
      if (
        isLiveDownloadState(state, integrationId) &&
        (!options.expectedMangaId ||
          state.mangaId === options.expectedMangaId) &&
        (!options.expectedSeriesTitle ||
          state.seriesTitle === options.expectedSeriesTitle)
      ) {
        return { optionsPage, tabId, state }
      }
    }
    await page.waitForTimeout(500)
  }

  const diagnostics = await optionsPage.evaluate(async (tabIds) => {
    const session = await chrome.storage.session.get(null)
    const relevantSessionEntries = Object.fromEntries(
      Object.entries(session).filter(
        ([key]) => key.startsWith("tab_") || key.toLowerCase().includes("error")
      )
    )
    const tabs = await chrome.tabs.query({})
    return {
      candidateTabIds: tabIds,
      sessionKeys: Object.keys(session).sort(),
      relevantSessionEntries,
      tabs: tabs.map((tab) => ({
        id: tab.id,
        status: tab.status,
        url: tab.url,
      })),
    }
  }, candidateTabIds)
  const pageDiagnostics = await page.evaluate(() => ({
    readyState: document.readyState,
    title: document.title,
    url: location.href,
    chapterLinks: document.querySelectorAll("a.detail--product__item[href]")
      .length,
    paginationLinks: document.querySelectorAll('a[href*="page="]').length,
  }))
  await optionsPage.close()
  throw new Error(
    `Timed out waiting for live download state for ${integrationId}. ` +
      `Last state: ${JSON.stringify(lastState)}. ` +
      `Page: ${JSON.stringify(pageDiagnostics)}. ` +
      `Runtime: ${JSON.stringify(diagnostics)}. ` +
      `Events: ${JSON.stringify(options.diagnosticEvents ?? [])}`
  )
}

export async function persistDownloadSettings(
  optionsPage: Page,
  downloadPatch: Partial<ExtensionSettings["downloads"]>,
  siteSettingsPatch?: StoredSiteIntegrationSettings
): Promise<void> {
  const nextSettings = await optionsPage.evaluate(
    async ({
      patch,
      sitePatch,
    }: {
      patch: Partial<ExtensionSettings["downloads"]>
      sitePatch?: StoredSiteIntegrationSettings
    }) => {
      const current = (await chrome.storage.local.get([
        "settings:global",
        "siteIntegrationSettings",
      ])) as {
        "settings:global"?: ExtensionSettings
        siteIntegrationSettings?: StoredSiteIntegrationSettings
      }

      const baseSettings = current["settings:global"]
      if (!baseSettings) {
        throw new Error("Missing persisted settings payload")
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
        "settings:global": mergedSettings,
        siteIntegrationSettings: mergedSiteSettings,
      })

      return {
        globalSettings: mergedSettings,
        siteIntegrationSettings: mergedSiteSettings,
      }
    },
    { patch: downloadPatch, sitePatch: siteSettingsPatch }
  )

  expect(nextSettings.globalSettings.downloads.defaultFormat).toBe("cbz")
}

export async function startSingleChapterDownload(
  optionsPage: Page,
  tabId: number,
  state: LiveDownloadState
): Promise<{ taskId: string; chapter: LiveChapter }> {
  const downloadableChapters = state.chapters.filter(
    (candidate) =>
      candidate.locked !== true &&
      typeof candidate.url === "string" &&
      candidate.url.length > 0
  )
  const chapter =
    state.siteIntegrationId === "mangadex" ||
    state.siteIntegrationId === "manhuagui"
      ? downloadableChapters.at(-1)
      : downloadableChapters[0]
  if (!chapter) {
    throw new Error(
      `No downloadable chapter found for ${state.siteIntegrationId}:${state.mangaId}`
    )
  }
  const extensionId = optionsPage.url().split("/")[2]
  const sidepanelPage = await openSidepanelHarness(
    optionsPage.context(),
    extensionId,
    optionsPage
  )
  try {
    await focusTab(optionsPage.context(), tabId)

    let snapshotIdentity:
      | {
          sourceWindowId: number
          sourceTabId: number
          sourceUrl: string
          siteIntegrationId: string
          seriesId: string
          seriesRevision: number
        }
      | undefined
    await expect
      .poll(
        async () => {
          const snapshot = await optionsPage.evaluate(async (sourceTabId) => {
            const tab = await chrome.tabs.get(sourceTabId)
            const stored = await chrome.storage.session.get(
              "activeTabContextByWindow"
            )
            const projection = (
              stored.activeTabContextByWindow as
                | Record<
                    string,
                    {
                      activeTabId?: number
                      revision?: number
                      context?: {
                        sourceUrl?: string
                        siteIntegrationId?: string
                        mangaId?: string
                        chaptersLoading?: boolean
                      }
                    }
                  >
                | undefined
            )?.[String(tab.windowId)]
            if (
              tab.active !== true ||
              projection?.activeTabId !== sourceTabId ||
              typeof projection.revision !== "number" ||
              typeof projection.context?.sourceUrl !== "string" ||
              typeof projection.context.siteIntegrationId !== "string" ||
              typeof projection.context.mangaId !== "string" ||
              projection.context.chaptersLoading === true
            ) {
              return null
            }
            return {
              sourceWindowId: tab.windowId,
              sourceTabId,
              sourceUrl: projection.context.sourceUrl,
              siteIntegrationId: projection.context.siteIntegrationId,
              seriesId: projection.context.mangaId,
              seriesRevision: projection.revision,
            }
          }, tabId)
          if (snapshot) {
            snapshotIdentity = snapshot
            return true
          }
          return false
        },
        { timeout: 15_000, intervals: [100] }
      )
      .toBe(true)
    if (!snapshotIdentity) {
      throw new Error(`No current series context snapshot for tab ${tabId}`)
    }
    const response = await sidepanelPage.evaluate(
      async (payload) => {
        const issuedAt = Date.now()
        return (await chrome.runtime.sendMessage({
          target: "background",
          type: "START_DOWNLOAD",
          commandId: crypto.randomUUID(),
          issuedAt,
          payload: {
            ...payload.snapshotIdentity,
            selectedChapterIds: [payload.selectedChapter.id],
          },
        })) as { success?: boolean; taskId?: string; error?: string }
      },
      { selectedChapter: chapter, snapshotIdentity }
    )

    expect(response?.success, response?.error ?? JSON.stringify(response)).toBe(
      true
    )
    expect(typeof response?.taskId).toBe("string")

    return {
      taskId: response.taskId as string,
      chapter,
    }
  } finally {
    await sidepanelPage.close()
  }
}

export async function readGlobalStateFromExtensionPage(
  optionsPage: Page
): Promise<{ downloadQueue: DownloadTaskState[] }> {
  return await optionsPage.evaluate(async (storageKey: string) => {
    const result = (await chrome.storage.local.get(storageKey)) as Record<
      string,
      unknown
    >
    return {
      downloadQueue: Array.isArray(result[storageKey])
        ? (result[storageKey] as DownloadTaskState[])
        : [],
    }
  }, LOCAL_STORAGE_KEYS.downloadQueue)
}

export async function readActiveTaskProgressFromExtensionPage(
  optionsPage: Page
): Promise<unknown> {
  return await optionsPage.evaluate(async (storageKey: string) => {
    const result = (await chrome.storage.session.get(storageKey)) as Record<
      string,
      unknown
    >
    return result[storageKey]
  }, SESSION_STORAGE_KEYS.activeTaskProgress)
}

export async function waitForTerminalTask(
  optionsPage: Page,
  taskId: string
): Promise<DownloadTaskState> {
  const startedAt = Date.now()
  let globalState: { downloadQueue: DownloadTaskState[] } | undefined
  let terminalTask: DownloadTaskState | undefined

  while (Date.now() - startedAt < LIVE_TASK_TERMINAL_TIMEOUT_MS) {
    globalState = await readGlobalStateFromExtensionPage(optionsPage)
    terminalTask = globalState?.downloadQueue.find(
      (task) =>
        task.id === taskId &&
        (task.status === "completed" ||
          task.status === "partial_success" ||
          task.status === "failed" ||
          task.status === "canceled")
    )
    if (terminalTask) {
      break
    }

    await optionsPage.waitForTimeout(100)
  }

  if (!globalState) {
    throw new Error(
      `Timed out waiting for global state while waiting for task ${taskId}`
    )
  }

  const task = globalState.downloadQueue.find(
    (candidate) => candidate.id === taskId
  )
  if (!task) {
    throw new Error(`Task ${taskId} disappeared before terminal assertion`)
  }

  if (!terminalTask) {
    const activeTaskProgress =
      await readActiveTaskProgressFromExtensionPage(optionsPage)
    throw new Error(
      `Timed out waiting for task ${taskId} to finish after ${LIVE_TASK_TERMINAL_TIMEOUT_MS}ms: ${JSON.stringify(
        {
          status: task.status,
          lastSuccessfulDownloadId: task.lastSuccessfulDownloadId,
          activeTaskProgress,
          chapters: task.chapters.map((chapter) => ({
            id: chapter.id,
            status: chapter.status,
            errorMessage: chapter.errorMessage,
            imagesFailed: chapter.imagesFailed,
            totalImages: chapter.totalImages,
            title: chapter.title,
          })),
        }
      )}`
    )
  }

  return task
}

export function assertTaskSucceeded(task: DownloadTaskState): void {
  const hasOnlyCompletedOutput = task.chapters.every((chapter) => {
    if (chapter.status !== "completed" || (chapter.imagesFailed ?? 0) > 0) {
      return false
    }

    const outputs = chapter.outputs
    return (
      !outputs ||
      (outputs.requested === outputs.committed && outputs.failed === 0)
    )
  })

  if (task.status === "completed" && hasOnlyCompletedOutput) {
    return
  }

  throw new Error(
    `Download task ${task.id} finished with status ${task.status}: ${JSON.stringify(
      {
        errorMessage: task.errorMessage,
        errorCategory: task.errorCategory,
        lastSuccessfulDownloadId: task.lastSuccessfulDownloadId,
        chapters: task.chapters.map((chapter) => ({
          id: chapter.id,
          status: chapter.status,
          errorMessage: chapter.errorMessage,
          imagesFailed: chapter.imagesFailed,
          totalImages: chapter.totalImages,
          outputs: chapter.outputs,
          title: chapter.title,
        })),
      }
    )}`
  )
}

export async function waitForBrowserDownload(
  optionsPage: Page,
  downloadId: number
): Promise<DownloadItemSnapshot> {
  const startedAt = Date.now()
  let lastItem: DownloadItemSnapshot | undefined

  while (Date.now() - startedAt < 30_000) {
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
      let exists: boolean
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

      if (item.state === "complete" && exists) {
        return lastItem
      }
    }

    await optionsPage.waitForTimeout(500)
  }

  throw new Error(
    `Timed out waiting for browser download ${downloadId}. Last item: ${JSON.stringify(lastItem)}`
  )
}

export async function expectZipArchiveFile(
  filePath: string | undefined
): Promise<void> {
  expect(typeof filePath).toBe("string")
  const handle = await fs.open(filePath as string, "r")

  try {
    const signature = Buffer.alloc(4)
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0)
    expect(bytesRead).toBe(4)
    expect(signature.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true)
  } finally {
    await handle.close()
  }
}

export async function seedCustomDirectoryHandle(
  optionsPage: Page
): Promise<string> {
  return await optionsPage.evaluate(async () => {
    const directoryName = `live-downloads-${Date.now()}`
    const opfsRoot = await navigator.storage.getDirectory()
    const seededDirectory = await opfsRoot.getDirectoryHandle(directoryName, {
      create: true,
    })

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("tako-fs", 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains("handles")) {
          db.createObjectStore("handles")
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () =>
        reject(request.error ?? new Error("Failed to open tako-fs IndexedDB"))
    })

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("handles", "readwrite")
      const store = transaction.objectStore("handles")
      store.put(seededDirectory, "download-root")
      transaction.oncomplete = () => resolve()
      transaction.onerror = () =>
        reject(
          transaction.error ?? new Error("Failed to seed download-root handle")
        )
    })

    return directoryName
  })
}

export async function listSeededDirectoryFiles(
  optionsPage: Page,
  directoryName: string
): Promise<SeededDirectoryFile[]> {
  return await optionsPage.evaluate(async (name: string) => {
    const opfsRoot = await navigator.storage.getDirectory()
    const seededDirectory = await opfsRoot.getDirectoryHandle(name)
    const files: SeededDirectoryFile[] = []

    const walk = async (
      directory: FileSystemDirectoryHandle,
      prefix: string
    ): Promise<void> => {
      for await (const [entryName, entryHandle] of directory.entries()) {
        const nextPath =
          prefix.length > 0 ? `${prefix}/${entryName}` : entryName
        if (entryHandle.kind === "directory") {
          await walk(entryHandle as FileSystemDirectoryHandle, nextPath)
          continue
        }

        const file = await (entryHandle as FileSystemFileHandle).getFile()
        files.push({ path: nextPath, size: file.size })
      }
    }

    await walk(seededDirectory, "")
    return files
  }, directoryName)
}

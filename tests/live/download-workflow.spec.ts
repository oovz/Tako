import fs from "node:fs/promises"
import type { BrowserContext, Page } from "@playwright/test"

import { test, expect } from "../e2e/fixtures/extension"
import {
  focusTab,
  getSessionState,
  getTabId,
  openSidepanelHarness,
  waitForActiveSeriesContextRevision,
} from "../e2e/fixtures/state-helpers"
import {
  LIVE_COMICNETTAI_REFERENCE_URL,
  LIVE_MANGADEX_REFERENCE_URL,
  LIVE_MANGAMILLION_REFERENCE_URL,
  LIVE_MANHUAGUI_REFERENCE_URL,
  LIVE_PIXIV_COMIC_REFERENCE_URL,
  LIVE_SHONENJUMPPLUS_REFERENCE_URL,
} from "../e2e/fixtures/test-domains-constants"
import { resolveCandidateTabIds } from "./fixtures/download-workflow-helpers"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import type { MangaPageState } from "@/src/types/tab-state"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import {
  LOCAL_STORAGE_KEYS,
  SESSION_STORAGE_KEYS,
} from "@/src/runtime/storage-keys"

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

type LiveDownloadState = Pick<
  MangaPageState,
  "siteIntegrationId" | "mangaId" | "seriesTitle" | "metadata"
> & {
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

// Canary series — these manga IDs and titles are single points of failure.
// If a series is removed or redirected on the live site, the corresponding
// test case will fail. Monitor these series and update IDs if they change.
const browserWorkflowCases: BrowserWorkflowCase[] = [
  {
    name: "mangadex hunter-x-hunter",
    integrationId: "mangadex",
    url: LIVE_MANGADEX_REFERENCE_URL,
    expectedMangaId: "db692d58-4b13-4174-ae8c-30c515c0689c",
    expectedSeriesTitle: "Hunter x Hunter",
  },
  {
    name: "pixiv-comic default",
    integrationId: "pixiv-comic",
    url: LIVE_PIXIV_COMIC_REFERENCE_URL,
  },
  {
    name: "shonenjumpplus default",
    integrationId: "shonenjumpplus",
    url: LIVE_SHONENJUMPPLUS_REFERENCE_URL,
  },
  {
    name: "manhuagui kimetsu-no-yaiba",
    integrationId: "manhuagui",
    url: LIVE_MANHUAGUI_REFERENCE_URL,
  },
  {
    name: "comicnettai kemutai-hanashi",
    integrationId: "comicnettai",
    url: LIVE_COMICNETTAI_REFERENCE_URL,
    expectedMangaId: "9",
    expectedSeriesTitle: "煙たい話",
  },
  {
    name: "mangamillion one-piece",
    integrationId: "mangamillion",
    url: LIVE_MANGAMILLION_REFERENCE_URL,
    expectedMangaId: "1",
    expectedSeriesTitle: "One Piece",
  },
]

const LIVE_TASK_TERMINAL_TIMEOUT_MS = 180_000
function isLiveDownloadState(
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

async function openOptionsPage(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "domcontentloaded",
  })
  return page
}

async function seedMangadexWebsitePreferences(page: Page): Promise<void> {
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

async function seedMangadexSessionPreferences(
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

async function loadLiveDownloadState(
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

async function persistDownloadSettings(
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

async function startSingleChapterDownload(
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
    const seriesRevision = await waitForActiveSeriesContextRevision(
      optionsPage.context(),
      tabId
    )

    const snapshotIdentity = await optionsPage.evaluate(
      async ({ sourceTabId, seriesRevision }) => {
        const tab = await chrome.tabs.get(sourceTabId)
        const stored = await chrome.storage.session.get(
          "activeTabContextByWindow"
        )
        const projection = (
          stored.activeTabContextByWindow as Record<
            string,
            {
              revision?: number
              context?: {
                sourceUrl?: string
                siteIntegrationId?: string
                mangaId?: string
              }
            }
          >
        )?.[String(tab.windowId)]
        if (
          projection?.revision !== seriesRevision ||
          typeof projection.context?.sourceUrl !== "string" ||
          typeof projection.context.siteIntegrationId !== "string" ||
          typeof projection.context.mangaId !== "string"
        ) {
          throw new Error("Active series snapshot changed before dispatch")
        }
        return {
          sourceWindowId: tab.windowId,
          sourceTabId,
          sourceUrl: projection.context.sourceUrl,
          siteIntegrationId: projection.context.siteIntegrationId,
          seriesId: projection.context.mangaId,
          seriesRevision,
        }
      },
      { sourceTabId: tabId, seriesRevision }
    )
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

async function readGlobalStateFromExtensionPage(
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

async function readActiveTaskProgressFromExtensionPage(
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

async function waitForTerminalTask(
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

function assertTaskSucceeded(task: DownloadTaskState): void {
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

async function waitForBrowserDownload(
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

async function expectZipArchiveFile(
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

async function seedCustomDirectoryHandle(optionsPage: Page): Promise<string> {
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

async function listSeededDirectoryFiles(
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

test.describe("Live download workflows", () => {
  test.describe.configure({ timeout: 240_000 })

  for (const workflowCase of browserWorkflowCases) {
    test(`completes a browser-mode live single-chapter download for ${workflowCase.name}`, async ({
      context,
      extensionId,
    }) => {
      const page = await context.newPage()
      const diagnosticEvents: string[] = []
      const recordDiagnostic = (message: string) => {
        if (diagnosticEvents.length < 20) diagnosticEvents.push(message)
      }
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") {
          recordDiagnostic(`console:${message.type()}:${message.text()}`)
        }
      })
      page.on("pageerror", (error) => {
        recordDiagnostic(`pageerror:${error.message}`)
      })
      page.on("requestfailed", (request) => {
        recordDiagnostic(
          `requestfailed:${request.url()}:${request.failure()?.errorText ?? "unknown"}`
        )
      })
      await page.goto(workflowCase.url, { waitUntil: "domcontentloaded" })

      if (workflowCase.integrationId === "mangadex") {
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
          diagnosticEvents,
        }
      )

      if (workflowCase.integrationId === "mangadex") {
        await seedMangadexSessionPreferences(optionsPage, state.mangaId)
      }

      try {
        await persistDownloadSettings(
          optionsPage,
          {
            destination: "downloads-api",
            customDirectoryHandleId: null,
            defaultFormat: "cbz",
            conflictPolicy: "overwrite",
          },
          workflowCase.integrationId === "mangadex"
            ? {
                mangadex: {
                  autoReadMangaDexSettings: true,
                  imageQuality: "data-saver",
                },
              }
            : undefined
        )

        const { taskId } = await startSingleChapterDownload(
          optionsPage,
          tabId,
          state
        )
        const task = await waitForTerminalTask(optionsPage, taskId)

        assertTaskSucceeded(task)
        expect(typeof task.lastSuccessfulDownloadId).toBe("number")

        const downloadItem = await waitForBrowserDownload(
          optionsPage,
          task.lastSuccessfulDownloadId as number
        )
        expect(downloadItem.state).toBe("complete")
        expect(downloadItem.exists).toBe(true)
        await expectZipArchiveFile(downloadItem.filename)
      } finally {
        await optionsPage.close()
        await page.close()
      }
    })
  }

  test("writes a live MangaDex single-chapter download through the custom-folder pipeline", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    await page.goto(LIVE_MANGADEX_REFERENCE_URL, {
      waitUntil: "domcontentloaded",
    })
    await seedMangadexWebsitePreferences(page)

    const { optionsPage, tabId, state } = await loadLiveDownloadState(
      context,
      extensionId,
      page,
      "mangadex"
    )
    await seedMangadexSessionPreferences(optionsPage, state.mangaId)

    try {
      const seededDirectoryName = await seedCustomDirectoryHandle(optionsPage)

      await persistDownloadSettings(
        optionsPage,
        {
          destination: "file-system-access",
          customDirectoryHandleId: "download-root",
          defaultFormat: "cbz",
          conflictPolicy: "overwrite",
        },
        {
          mangadex: {
            autoReadMangaDexSettings: true,
            imageQuality: "data-saver",
          },
        }
      )

      const { taskId } = await startSingleChapterDownload(
        optionsPage,
        tabId,
        state
      )
      const task = await waitForTerminalTask(optionsPage, taskId)

      assertTaskSucceeded(task)
      expect(task.lastSuccessfulDownloadId).toBeUndefined()

      const startedAt = Date.now()
      let files: SeededDirectoryFile[] = []
      while (Date.now() - startedAt < 60_000) {
        files = await listSeededDirectoryFiles(optionsPage, seededDirectoryName)
        if (
          files.some(
            (file) => file.path.toLowerCase().endsWith(".cbz") && file.size > 0
          )
        ) {
          break
        }
        await optionsPage.waitForTimeout(500)
      }

      expect(
        files.some(
          (file) => file.path.toLowerCase().endsWith(".cbz") && file.size > 0
        )
      ).toBe(true)
    } finally {
      await optionsPage.close()
      await page.close()
    }
  })
})

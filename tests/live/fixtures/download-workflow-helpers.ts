import fs from "node:fs/promises"
import type { BrowserContext, Page, TestInfo } from "@playwright/test"
import { expect } from "@playwright/test"
import { getSessionState, getTabId } from "../../e2e/fixtures/state-helpers"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import type { MangaPageState } from "@/src/types/tab-state"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import { redactDiagnosticText } from "../../../src/runtime/diagnostic-redaction"
import {
  LOCAL_STORAGE_KEYS,
  SESSION_STORAGE_KEYS,
} from "@/src/runtime/storage-keys"
import type { LiveChapter } from "./metadata-extraction-helpers"
import { inspectChapterArchive } from "../../e2e/fixtures/chapter-artifact"
import { startSingleChapterDownload as dispatchSingleChapterDownload } from "../../e2e/fixtures/download-workflow-helpers"
import packageJson from "../../../package.json" with { type: "json" }
import { createCommandEnvelope } from "../../../src/runtime/command-envelope"
import type { RuntimeMessageResponse } from "../../../src/runtime/runtime-message-contracts"

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

export function createDiagnosticEventRecorder(maxEvents = 20): {
  diagnosticEvents: string[]
  recordDiagnostic: (message: unknown) => void
} {
  const diagnosticEvents: string[] = []
  return {
    diagnosticEvents,
    recordDiagnostic: (message) => {
      if (diagnosticEvents.length < maxEvents) {
        diagnosticEvents.push(redactDiagnosticText(message))
      }
    },
  }
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
      `Last state: ${redactDiagnosticText(lastState)}. ` +
      `Page: ${redactDiagnosticText(pageDiagnostics)}. ` +
      `Runtime: ${redactDiagnosticText(diagnostics)}. ` +
      `Events: ${redactDiagnosticText(options.diagnosticEvents ?? [])}`
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
      command,
    }: {
      patch: Partial<ExtensionSettings["downloads"]>
      sitePatch?: StoredSiteIntegrationSettings
      command: ReturnType<typeof createCommandEnvelope>
    }) => {
      const current: RuntimeMessageResponse<"GET_OPTIONS_CONFIGURATION"> =
        await chrome.runtime.sendMessage({
          target: "background",
          type: "GET_OPTIONS_CONFIGURATION",
        })
      if (!current.success) throw new Error(current.error)
      const configuration = current.data.configuration
      const baseSettings = configuration.settings

      const mergedSettings: ExtensionSettings = {
        ...baseSettings,
        downloads: {
          ...baseSettings.downloads,
          ...patch,
          includeCoverImage: false,
          includeComicInfo: false,
          normalizeImageFilenames: true,
          imagePaddingDigits: 3,
        },
      }

      const mergedSiteSettings: StoredSiteIntegrationSettings = {
        ...configuration.integrationSettings,
        ...(sitePatch ?? {}),
      }
      const saved: RuntimeMessageResponse<"SAVE_OPTIONS_CONFIGURATION"> =
        await chrome.runtime.sendMessage({
          target: "background",
          type: "SAVE_OPTIONS_CONFIGURATION",
          ...command,
          payload: {
            configuration: {
              ...configuration,
              settings: mergedSettings,
              integrationSettings: mergedSiteSettings,
            },
          },
        })
      if (!saved.success) throw new Error(saved.error)
      return saved.data.settings
    },
    {
      patch: downloadPatch,
      sitePatch: siteSettingsPatch,
      command: createCommandEnvelope(),
    }
  )

  expect(nextSettings.downloads.defaultFormat).toBe("cbz")
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
    state.siteIntegrationId === "readmanga"
      ? downloadableChapters.at(-1)
      : downloadableChapters[0]
  if (!chapter) {
    throw new Error(
      `No downloadable chapter found for ${state.siteIntegrationId}:${state.mangaId}`
    )
  }
  const taskId = await dispatchSingleChapterDownload(optionsPage, {
    sourceTabId: tabId,
    siteIntegrationId: state.siteIntegrationId,
    mangaId: state.mangaId,
    seriesTitle: state.seriesTitle,
    chapter,
  })
  return { taskId, chapter }
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
  taskId: string,
  timeoutMs = LIVE_TASK_TERMINAL_TIMEOUT_MS
): Promise<DownloadTaskState> {
  const startedAt = Date.now()
  let globalState: { downloadQueue: DownloadTaskState[] } | undefined
  let terminalTask: DownloadTaskState | undefined

  while (Date.now() - startedAt < timeoutMs) {
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
      redactDiagnosticText({
        event: "task-timeout",
        taskId,
        timeoutMs,
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
      })
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
    redactDiagnosticText({
      event: "task-finished",
      taskId: task.id,
      status: task.status,
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
    })
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
    redactDiagnosticText({
      event: "browser-download-timeout",
      downloadId,
      lastItem,
    })
  )
}

async function retainArtifact(
  testInfo: TestInfo,
  name: string,
  content: string | Uint8Array,
  contentType: string
): Promise<void> {
  const path = testInfo.outputPath(name)
  await fs.writeFile(path, content)
  await testInfo.attach(name, { path, contentType })
}

export async function expectSavedChapterArchive(
  optionsPage: Page,
  bytes: Uint8Array,
  task: DownloadTaskState,
  workUrl: string,
  testInfo: TestInfo
): Promise<void> {
  await retainArtifact(
    testInfo,
    "saved-chapter.cbz",
    bytes,
    "application/vnd.comicbook+zip"
  )
  expect(task.chapters).toHaveLength(1)
  const chapter = task.chapters[0]
  expect(chapter.totalImages).toBeGreaterThan(0)
  const images = await inspectChapterArchive(
    optionsPage,
    bytes,
    chapter.totalImages!
  )
  await retainArtifact(
    testInfo,
    "chapter-artifact-inspection.json",
    JSON.stringify(
      {
        inspectedAt: new Date().toISOString(),
        takoVersion: packageJson.version,
        browser: await optionsPage.evaluate(() => navigator.userAgent),
        integrationId: task.siteIntegrationId,
        workUrl,
        seriesTitle: task.seriesTitle,
        chapter: { id: chapter.id, url: chapter.url, title: chapter.title },
        resolvedPageCount: chapter.totalImages,
        images: images.map(({ name, width, height }) => ({
          name,
          width,
          height,
        })),
        visualReview:
          "Compare saved pages with the site's reader before recording visual correctness.",
      },
      null,
      2
    ),
    "application/json"
  )
  for (const image of images) {
    expect(image.width).toBeGreaterThan(1)
    expect(image.height).toBeGreaterThan(1)
    if (image.preview) {
      await retainArtifact(
        testInfo,
        `saved-page-${image.name}.png`,
        Buffer.from(image.preview.split(",")[1], "base64"),
        "image/png"
      )
    }
  }
}

export async function expectBrowserChapterArchive(
  optionsPage: Page,
  task: DownloadTaskState,
  workUrl: string,
  testInfo: TestInfo
): Promise<void> {
  expect(typeof task.lastSuccessfulDownloadId).toBe("number")
  const item = await waitForBrowserDownload(
    optionsPage,
    task.lastSuccessfulDownloadId!
  )
  expect(item.state).toBe("complete")
  expect(item.exists).toBe(true)
  await expectSavedChapterArchive(
    optionsPage,
    await fs.readFile(item.filename!),
    task,
    workUrl,
    testInfo
  )
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
      const request = indexedDB.open("tako-fs")
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

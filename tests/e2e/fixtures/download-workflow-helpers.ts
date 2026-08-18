/**
 * @file download-workflow-helpers.ts
 * @description Shared helpers for `{integration}-download-workflow.spec.ts`.
 *
 * Every mocked download-workflow spec follows the same template:
 *
 * 1. Navigate a page to the series URL and wait for tab state.
 * 2. Open the extension options page so privileged Chrome APIs are
 *    reachable from a real page context.
 * 3. Seed an OPFS directory + `tako-fs/handles[download-root]` IndexedDB
 *    handle so custom-folder downloads land in a test-scoped sandbox
 *    instead of the user's Downloads.
 * 4. Apply custom-mode settings (defaultFormat `cbz`)
 *    so the archive writer goes through the OPFS path.
 * 5. Dispatch `START_DOWNLOAD` for one chapter and wait for the task to
 *    reach a terminal state.
 * 6. Assert success and verify at least one non-empty file appeared in the
 *    seeded OPFS directory.
 *
 * Shaping these as shared helpers keeps each spec focused on integration
 * specifics (URL, chapter dataset, preferences) without duplicating the
 * 100-line plumbing.
 */

import type { BrowserContext, Page } from "@playwright/test"
import { expect } from "@playwright/test"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import {
  focusTab,
  type QueueTestState,
  waitForGlobalState,
} from "./state-helpers"

export type StoredSiteIntegrationSettings = Record<
  string,
  Record<string, unknown>
>

export interface SeededDirectoryFile {
  path: string
  size: number
}

export interface DownloadChapterSelection {
  id: string
  title: string
  url: string
  index: number
  chapterLabel?: string
  chapterNumber?: number
  volumeLabel?: string
  volumeNumber?: number
  language?: string
}

export interface StartDownloadInput {
  sourceTabId: number
  siteIntegrationId: string
  mangaId: string
  seriesTitle: string
  chapter: DownloadChapterSelection
}

/**
 * Open the extension options page in a fresh tab. Returned page has access
 * to privileged `chrome.*` APIs (storage, runtime.sendMessage) identical to
 * the extension's own pages. Specs MUST close this page in a `finally`.
 */
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

/**
 * Seed a throwaway OPFS directory + `tako-fs/handles[download-root]`
 * IndexedDB entry so custom-folder downloads land in a spec-scoped
 * sandbox. Returns the directory name so the spec can inspect the
 * contents afterwards.
 *
 * Lifted from the live download-workflow spec to keep both paths
 * identical; if the production OPFS bootstrap changes, both live and
 * mocked e2e coverage break together.
 */
export async function seedCustomDirectoryHandle(
  optionsPage: Page
): Promise<string> {
  return await optionsPage.evaluate(async () => {
    const directoryName = `e2e-downloads-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
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

/**
 * Walk the seeded OPFS directory and return `{path, size}` for every
 * file found (recursive). Empty files are returned with `size: 0` so the
 * spec can distinguish "file missing" from "file created but writer bailed
 * before flushing".
 */
export async function listSeededDirectoryFiles(
  optionsPage: Page,
  directoryName: string
): Promise<SeededDirectoryFile[]> {
  return await optionsPage.evaluate(async (name: string) => {
    const opfsRoot = await navigator.storage.getDirectory()
    const seededDirectory = await opfsRoot.getDirectoryHandle(name)
    const files: Array<{ path: string; size: number }> = []

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

/**
 * Read a file from a seeded OPFS directory. This is intentionally limited to
 * test fixtures so download-workflow specs can validate archive contents
 * rather than treating a non-empty output file as proof of a correct result.
 */
export async function readSeededDirectoryFile(
  optionsPage: Page,
  directoryName: string,
  filePath: string
): Promise<Uint8Array> {
  const bytes = await optionsPage.evaluate(
    async ({ directoryName: name, targetPath }) => {
      const pathSegments = targetPath.split("/").filter(Boolean)
      const fileName = pathSegments.pop()
      if (!fileName) {
        throw new Error("A seeded directory file path is required")
      }

      const opfsRoot = await navigator.storage.getDirectory()
      let directory = await opfsRoot.getDirectoryHandle(name)
      for (const segment of pathSegments) {
        directory = await directory.getDirectoryHandle(segment)
      }

      const file = await (await directory.getFileHandle(fileName)).getFile()
      return Array.from(new Uint8Array(await file.arrayBuffer()))
    },
    { directoryName, targetPath: filePath }
  )

  return Uint8Array.from(bytes)
}

/**
 * Persist the download settings required to exercise the custom-folder
 * pipeline (destination = 'file-system-access', format = 'cbz', concurrency = 1) plus
 * any site-integration preferences the test needs. The background observes
 * the durable settings write through its synchronous storage subscriber.
 */
export async function persistCustomModeDownloadSettings(
  optionsPage: Page,
  siteSettingsPatch?: StoredSiteIntegrationSettings
): Promise<void> {
  const nextSettings = await optionsPage.evaluate(
    async ({ sitePatch }: { sitePatch?: StoredSiteIntegrationSettings }) => {
      const current = (await chrome.storage.local.get([
        "settings:global",
        "siteIntegrationSettings",
      ])) as {
        "settings:global"?: ExtensionSettings
        siteIntegrationSettings?: StoredSiteIntegrationSettings
      }

      const baseSettings = current["settings:global"]
      if (!baseSettings) {
        throw new Error(
          "Missing persisted settings payload — extension did not hydrate defaults"
        )
      }

      const mergedSettings: ExtensionSettings = {
        ...baseSettings,
        downloads: {
          ...baseSettings.downloads,
          destination: "file-system-access",
          customDirectoryHandleId: "download-root",
          defaultFormat: "cbz",
          conflictPolicy: "overwrite",
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
    { sitePatch: siteSettingsPatch }
  )

  expect(nextSettings.globalSettings.downloads.defaultFormat).toBe("cbz")
  expect(nextSettings.globalSettings.downloads.destination).toBe(
    "file-system-access"
  )
  expect(nextSettings.globalSettings.downloads.customDirectoryHandleId).toBe(
    "download-root"
  )
}

/** Persist the default browser-download CBZ path used by fresh installs. */
export async function persistBrowserModeDownloadSettings(
  optionsPage: Page,
  siteSettingsPatch?: StoredSiteIntegrationSettings
): Promise<void> {
  const nextSettings = await optionsPage.evaluate(
    async ({ sitePatch }: { sitePatch?: StoredSiteIntegrationSettings }) => {
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
          destination: "downloads-api",
          defaultFormat: "cbz",
        },
      }
      await chrome.storage.local.set({
        "settings:global": mergedSettings,
        siteIntegrationSettings: {
          ...(current.siteIntegrationSettings ?? {}),
          ...(sitePatch ?? {}),
        },
      })
      return mergedSettings
    },
    { sitePatch: siteSettingsPatch }
  )

  expect(nextSettings.downloads.destination).toBe("downloads-api")
  expect(nextSettings.downloads.defaultFormat).toBe("cbz")
}

export async function waitForBrowserDownloadArtifact(
  optionsPage: Page,
  downloadId: number
): Promise<{ filename: string; fileSize: number; state: string }> {
  return await optionsPage.evaluate(async (id: number) => {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const [item] = await chrome.downloads.search({ id })
      if (item?.state === "complete") {
        return {
          filename: item.filename,
          fileSize: item.fileSize,
          state: item.state,
        }
      }
      if (item?.state === "interrupted") {
        throw new Error(`Browser download interrupted: ${item.error}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`Browser download ${id} did not complete`)
  }, downloadId)
}

/**
 * Seed the per-series MangaDex preferences (`mangadexUserPreferencesBySeries`)
 * so the background integration does not need a live localStorage read from
 * the mangadex.org page. Use only for the MangaDex download-workflow spec.
 */
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
      dataSaver: false,
      filteredLanguages: ["en"],
    }

    await chrome.storage.session.set({ [storageKey]: bySeries })
  }, seriesId)
}

/**
 * Dispatch `START_DOWNLOAD` for one chapter and return the queue task id.
 * Mirrors the live helper so spec assertions share the same oracle.
 */
export async function startSingleChapterDownload(
  optionsPage: Page,
  input: StartDownloadInput
): Promise<string> {
  const extensionId = new URL(optionsPage.url()).hostname
  const sidepanelPage = await optionsPage.context().newPage()
  await sidepanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
    waitUntil: "domcontentloaded",
  })
  try {
    // Opening the temporary Side Panel page activates an extension tab and
    // starts an asynchronous background projection. Wait for that activation
    // to stop owning the source window before reactivating the manga tab;
    // otherwise the older Side Panel projection can land after the source
    // activation and invalidate the snapshot captured below.
    await sidepanelPage.bringToFront()
    await expect
      .poll(
        () =>
          optionsPage.evaluate(async (sourceTabId) => {
            const sourceTab = await chrome.tabs.get(sourceTabId)
            const stored = await chrome.storage.session.get(
              "activeTabContextByWindow"
            )
            const projection = (
              stored.activeTabContextByWindow as
                Record<string, { activeTabId?: number }> | undefined
            )?.[String(sourceTab.windowId)]
            return (
              sourceTab.active === false &&
              projection?.activeTabId !== sourceTabId
            )
          }, input.sourceTabId),
        { timeout: 15_000, intervals: [100] }
      )
      .toBe(true)

    await focusTab(optionsPage.context(), input.sourceTabId)

    // Wait for the source tab to own the window projection AND capture the
    // dispatch snapshot in the same read. Validating and capturing in one
    // tick removes the wait-then-reread window where a late background write
    // (e.g. the Side Panel projection resolving after source activation)
    // could bump the revision between the wait and the snapshot read. A
    // write that still lands after this tick is rejected by the background's
    // own stale_series_context validation when START_DOWNLOAD is applied.
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
          }, input.sourceTabId)
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
      throw new Error(
        `No current series context snapshot for tab ${input.sourceTabId}`
      )
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
            selectedChapterIds: [payload.chapter.id],
          },
        })) as { success?: boolean; taskId?: string; error?: string }
      },
      { chapter: input.chapter, snapshotIdentity }
    )

    expect(response?.success, response?.error ?? JSON.stringify(response)).toBe(
      true
    )
    expect(typeof response?.taskId).toBe("string")
    return response.taskId as string
  } finally {
    await sidepanelPage.close()
  }
}

/**
 * Wait for the queue task to reach a terminal status (completed /
 * partial_success / failed / canceled). Throws on timeout so the spec
 * output surfaces the final global state for debugging.
 */
export async function waitForTerminalTask(
  context: BrowserContext,
  taskId: string,
  timeoutMs = 120_000
): Promise<DownloadTaskState> {
  const globalState = await waitForGlobalState(
    context,
    (state: QueueTestState) =>
      state.downloadQueue.some(
        (task) =>
          task.id === taskId &&
          (task.status === "completed" ||
            task.status === "partial_success" ||
            task.status === "failed" ||
            task.status === "canceled")
      ),
    { timeout: timeoutMs }
  )

  const task = globalState.downloadQueue.find(
    (candidate) => candidate.id === taskId
  )
  if (!task) {
    throw new Error(
      `Task ${taskId} disappeared from queue before terminal assertion`
    )
  }

  return task
}

/**
 * Assert the task reached a successful terminal state. Raises with a
 * diagnostic error body on failure so the spec failure message includes
 * chapter-level status, which usually points at the broken stage
 * (fetch / parse / descramble / archive).
 */
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

/**
 * Poll the seeded OPFS directory until at least one non-empty `.cbz` file
 * appears. Returns the list so the spec can make additional assertions
 * (e.g. filename contains series title).
 */
export async function waitForCbzArtifact(
  optionsPage: Page,
  directoryName: string,
  timeoutMs = 30_000
): Promise<SeededDirectoryFile[]> {
  let files: SeededDirectoryFile[] = []

  await expect
    .poll(
      async () => {
        files = await listSeededDirectoryFiles(optionsPage, directoryName)
        return files.some(
          (file) => file.path.toLowerCase().endsWith(".cbz") && file.size > 0
        )
      },
      { timeout: timeoutMs }
    )
    .toBe(true)

  return files
}

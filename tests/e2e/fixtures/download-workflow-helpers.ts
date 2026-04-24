/**
 * @file download-workflow-helpers.ts
 * @description Shared helpers for Phase-3 `{integration}-download-workflow.spec.ts`.
 *
 * Every mocked download-workflow spec follows the same template:
 *
 * 1. Navigate a page to the series URL and wait for tab state.
 * 2. Open the extension options page so privileged Chrome APIs are
 *    reachable from a real page context.
 * 3. Seed an OPFS directory + `tako-fs/handles[download-root]` IndexedDB
 *    handle so custom-folder downloads land in a test-scoped sandbox
 *    instead of the user's Downloads.
 * 4. Apply custom-mode settings (defaultFormat `cbz`, single concurrency)
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

import type { BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import type { DownloadTaskState, GlobalAppState } from '@/src/types/queue-state';
import type { ExtensionSettings } from '@/src/storage/settings-types';
import { waitForGlobalState } from './state-helpers';

export type StoredSiteIntegrationSettings = Record<string, Record<string, unknown>>;

export interface SeededDirectoryFile {
  path: string;
  size: number;
}

export interface DownloadChapterSelection {
  id: string;
  title: string;
  url: string;
  index: number;
  chapterLabel?: string;
  chapterNumber?: number;
  volumeLabel?: string;
  volumeNumber?: number;
  language?: string;
}

export interface StartDownloadInput {
  sourceTabId: number;
  siteIntegrationId: string;
  mangaId: string;
  seriesTitle: string;
  chapter: DownloadChapterSelection;
}

/**
 * Open the extension options page in a fresh tab. Returned page has access
 * to privileged `chrome.*` APIs (storage, runtime.sendMessage) identical to
 * the extension's own pages. Specs MUST close this page in a `finally`.
 */
export async function openOptionsPage(
  context: BrowserContext,
  extensionId: string,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
  return page;
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
export async function seedCustomDirectoryHandle(optionsPage: Page): Promise<string> {
  return await optionsPage.evaluate(async () => {
    const directoryName = `e2e-downloads-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const opfsRoot = await navigator.storage.getDirectory();
    const seededDirectory = await opfsRoot.getDirectoryHandle(directoryName, { create: true });

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('tako-fs', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Failed to open tako-fs IndexedDB'));
    });

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('handles', 'readwrite');
      const store = transaction.objectStore('handles');
      store.put(seededDirectory, 'download-root');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Failed to seed download-root handle'));
    });

    return directoryName;
  });
}

/**
 * Walk the seeded OPFS directory and return `{path, size}` for every
 * file found (recursive). Empty files are returned with `size: 0` so the
 * spec can distinguish "file missing" from "file created but writer bailed
 * before flushing".
 */
export async function listSeededDirectoryFiles(
  optionsPage: Page,
  directoryName: string,
): Promise<SeededDirectoryFile[]> {
  return await optionsPage.evaluate(async (name: string) => {
    const opfsRoot = await navigator.storage.getDirectory();
    const seededDirectory = await opfsRoot.getDirectoryHandle(name);
    const files: Array<{ path: string; size: number }> = [];

    const walk = async (directory: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const [entryName, entryHandle] of directory.entries()) {
        const nextPath = prefix.length > 0 ? `${prefix}/${entryName}` : entryName;
        if (entryHandle.kind === 'directory') {
          await walk(entryHandle as FileSystemDirectoryHandle, nextPath);
          continue;
        }

        const file = await (entryHandle as FileSystemFileHandle).getFile();
        files.push({ path: nextPath, size: file.size });
      }
    };

    await walk(seededDirectory, '');
    return files;
  }, directoryName);
}

/**
 * Persist the download settings required to exercise the custom-folder
 * pipeline (downloadMode = 'custom', format = 'cbz', concurrency = 1) plus
 * any site-integration preferences the test needs. The SW is notified via
 * `SYNC_SETTINGS_TO_STATE` so the queue picks up the new values before the
 * next `START_DOWNLOAD`.
 */
export async function persistCustomModeDownloadSettings(
  optionsPage: Page,
  siteSettingsPatch?: StoredSiteIntegrationSettings,
): Promise<void> {
  const nextSettings = await optionsPage.evaluate(
    async ({ sitePatch }: { sitePatch?: StoredSiteIntegrationSettings }) => {
      const current = await chrome.storage.local.get(['settings:global', 'siteIntegrationSettings']) as {
        'settings:global'?: ExtensionSettings;
        siteIntegrationSettings?: StoredSiteIntegrationSettings;
      };

      const baseSettings = current['settings:global'];
      if (!baseSettings) {
        throw new Error('Missing persisted settings payload — extension did not hydrate defaults');
      }

      const mergedSettings: ExtensionSettings = {
        ...baseSettings,
        downloads: {
          ...baseSettings.downloads,
          downloadMode: 'custom',
          customDirectoryEnabled: true,
          customDirectoryHandleId: 'download-root',
          defaultFormat: 'cbz',
          maxConcurrentChapters: 1,
          overwriteExisting: true,
        },
      };

      const mergedSiteSettings: StoredSiteIntegrationSettings = {
        ...(current.siteIntegrationSettings ?? {}),
        ...(sitePatch ?? {}),
      };

      await chrome.storage.local.set({
        'settings:global': mergedSettings,
        siteIntegrationSettings: mergedSiteSettings,
      });

      await chrome.runtime.sendMessage({
        type: 'SYNC_SETTINGS_TO_STATE',
        payload: { settings: mergedSettings },
      });

      return {
        globalSettings: mergedSettings,
        siteIntegrationSettings: mergedSiteSettings,
      };
    },
    { sitePatch: siteSettingsPatch },
  );

  expect(nextSettings.globalSettings.downloads.defaultFormat).toBe('cbz');
  expect(nextSettings.globalSettings.downloads.downloadMode).toBe('custom');
  expect(nextSettings.globalSettings.downloads.customDirectoryHandleId).toBe('download-root');
}

/**
 * Seed the per-series MangaDex preferences (`mangadexUserPreferencesBySeries`)
 * so the background integration does not need a live localStorage read from
 * the mangadex.org page. Use only for the MangaDex download-workflow spec.
 */
export async function seedMangadexSessionPreferences(
  optionsPage: Page,
  seriesId: string,
): Promise<void> {
  await optionsPage.evaluate(async (mangaId: string) => {
    const storageKey = 'mangadexUserPreferencesBySeries';
    const current = await chrome.storage.session.get(storageKey) as Record<string, unknown>;
    const existing = current[storageKey];
    const bySeries = existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};

    bySeries[`mangadex#${mangaId}`] = {
      dataSaver: false,
      filteredLanguages: ['en'],
    };

    await chrome.storage.session.set({ [storageKey]: bySeries });
  }, seriesId);
}

/**
 * Dispatch `START_DOWNLOAD` for one chapter and return the queue task id.
 * Mirrors the live helper so spec assertions share the same oracle.
 */
export async function startSingleChapterDownload(
  optionsPage: Page,
  input: StartDownloadInput,
): Promise<string> {
  const response = await optionsPage.evaluate(async (payload) => {
    return await chrome.runtime.sendMessage({
      type: 'START_DOWNLOAD',
      payload: {
        sourceTabId: payload.sourceTabId,
        siteIntegrationId: payload.siteIntegrationId,
        mangaId: payload.mangaId,
        seriesTitle: payload.seriesTitle,
        chapters: [
          {
            id: payload.chapter.id,
            title: payload.chapter.title,
            url: payload.chapter.url,
            index: payload.chapter.index,
            chapterLabel: payload.chapter.chapterLabel,
            chapterNumber: payload.chapter.chapterNumber,
            volumeLabel: payload.chapter.volumeLabel,
            volumeNumber: payload.chapter.volumeNumber,
            language: payload.chapter.language,
          },
        ],
      },
    }) as { success?: boolean; taskId?: string; error?: string };
  }, input);

  expect(response?.success).toBe(true);
  expect(typeof response?.taskId).toBe('string');
  return response.taskId as string;
}

/**
 * Wait for the queue task to reach a terminal status (completed /
 * partial_success / failed / canceled). Throws on timeout so the spec
 * output surfaces the final global state for debugging.
 */
export async function waitForTerminalTask(
  context: BrowserContext,
  taskId: string,
  timeoutMs = 120_000,
): Promise<DownloadTaskState> {
  const globalState = await waitForGlobalState(
    context,
    (state: GlobalAppState) => state.downloadQueue.some((task) => task.id === taskId && (
      task.status === 'completed'
      || task.status === 'partial_success'
      || task.status === 'failed'
      || task.status === 'canceled'
    )),
    { timeout: timeoutMs },
  );

  const task = globalState.downloadQueue.find((candidate) => candidate.id === taskId);
  if (!task) {
    throw new Error(`Task ${taskId} disappeared from queue before terminal assertion`);
  }

  return task;
}

/**
 * Assert the task reached a successful terminal state. Raises with a
 * diagnostic error body on failure so the spec failure message includes
 * chapter-level status, which usually points at the broken stage
 * (fetch / parse / descramble / archive).
 */
export function assertTaskSucceeded(task: DownloadTaskState): void {
  if (task.status === 'completed' || task.status === 'partial_success') {
    return;
  }

  throw new Error(`Download task ${task.id} finished with status ${task.status}: ${JSON.stringify({
    errorMessage: task.errorMessage,
    errorCategory: task.errorCategory,
    chapters: task.chapters.map((chapter) => ({
      id: chapter.id,
      status: chapter.status,
      errorMessage: chapter.errorMessage,
      imagesFailed: chapter.imagesFailed,
      totalImages: chapter.totalImages,
      title: chapter.title,
    })),
  })}`);
}

/**
 * Poll the seeded OPFS directory until at least one non-empty `.cbz` file
 * appears. Returns the list so the spec can make additional assertions
 * (e.g. filename contains series title).
 */
export async function waitForCbzArtifact(
  optionsPage: Page,
  directoryName: string,
  timeoutMs = 30_000,
): Promise<SeededDirectoryFile[]> {
  const startedAt = Date.now();
  let files: SeededDirectoryFile[] = [];
  while (Date.now() - startedAt < timeoutMs) {
    files = await listSeededDirectoryFiles(optionsPage, directoryName);
    if (files.some((file) => file.path.toLowerCase().endsWith('.cbz') && file.size > 0)) {
      return files;
    }
    await optionsPage.waitForTimeout(500);
  }

  throw new Error(`Timed out waiting for a .cbz artifact in OPFS ${directoryName}. Files found: ${JSON.stringify(files)}`);
}

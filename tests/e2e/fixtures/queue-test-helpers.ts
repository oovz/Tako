import type { BrowserContext, Worker } from '@playwright/test'

import { ensureOffscreenAliveForActiveQueue, setSessionState, waitForGlobalState, getGlobalState } from './state-helpers'
import { createTaskSettingsSnapshot } from '@/src/runtime/settings-snapshot'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import { projectToQueueView } from '@/src/runtime/projection'
import type { DownloadTaskState } from '../../../src/types/queue-state'
import type { ChapterState } from '../../../src/types/tab-state'

function isBackgroundWorkerUrl(url: string): boolean {
  return url.startsWith('chrome-extension://') && /\/background(?:\.js)?$/i.test(url)
}

export function makeChapter(url: string, status: ChapterState['status']): ChapterState {
  return {
    id: url,
    url,
    title: url,
    status,
    lastUpdated: Date.now(),
  } as ChapterState
}

export function makeTask(partial: Partial<DownloadTaskState> & { id: string; seriesTitle: string; status: DownloadTaskState['status']; created: number }): DownloadTaskState {
  const siteIntegrationId = partial.siteIntegrationId ?? 'mangadex'
  const base: DownloadTaskState = {
    id: partial.id,
    siteIntegrationId,
    mangaId: 'mangadex:series-1',
    seriesTitle: partial.seriesTitle,
    chapters: [makeChapter(`${partial.id}-chapter-1`, 'queued')],
    status: partial.status,
    created: partial.created,
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, siteIntegrationId),
  }

  return {
    ...base,
    ...partial,
  }
}

async function getExtensionWorker(context: BrowserContext): Promise<Worker> {
  const expectedName = 'Tako Manga Downloader'
  const isOurWorker = async (sw: Worker): Promise<boolean> => {
    if (isBackgroundWorkerUrl(sw.url())) return true
    try {
      const name = await sw.evaluate(() => chrome.runtime.getManifest().name)
      return name === expectedName
    } catch {
      return false
    }
  }

  let worker: Worker | undefined
  for (let attempt = 0; attempt < 30; attempt++) {
    const candidates = context.serviceWorkers().filter((sw) => sw.url().startsWith('chrome-extension://'))
    for (const sw of candidates) {
      if (await isOurWorker(sw)) {
        worker = sw
        break
      }
    }
    if (worker) break

    try {
      await context.waitForEvent('serviceworker', {
        timeout: 1000,
        predicate: (sw) => sw.url().startsWith('chrome-extension://'),
      })
    } catch {
      void 0
    }
  }

  if (!worker) {
    throw new Error('Service worker not found')
  }

  return worker
}

export async function seedGlobalQueue(context: BrowserContext, tasks: DownloadTaskState[]): Promise<void> {
  const ids = tasks.map((task) => task.id).sort()
  const projected = projectToQueueView(tasks)
  const worker = await getExtensionWorker(context)

  if (tasks.some((task) => task.status === 'downloading')) {
    await ensureOffscreenAliveForActiveQueue(context)
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await getGlobalState(context)
    const next = {
      ...(existing ?? {}),
      downloadQueue: tasks,
      settings: existing?.settings ?? DEFAULT_SETTINGS,
      lastActivity: Date.now(),
    }
    await setSessionState(context, SESSION_STORAGE_KEYS.globalState, next as any)
    await setSessionState(context, 'queueView', projected.queueView as any)
    await worker.evaluate(async (downloadQueue: DownloadTaskState[]) => {
      await chrome.storage.local.set({ downloadQueue })
    }, tasks)

    // Small delay to allow storage change events to propagate
    await new Promise((resolve) => setTimeout(resolve, 150))

    try {
      await waitForGlobalState(context, (state) => {
        const queue = state.downloadQueue ?? []
        if (queue.length !== tasks.length) return false
        const queueIds = queue.map((task) => task.id).sort()
        return queueIds.length === ids.length && queueIds.every((id, idx) => id === ids[idx])
      }, { timeout: 15000 })

      const expectedQueueView = projected.queueView
        .map((task) => ({ id: task.id, status: task.status }))
        .sort((left, right) => left.id.localeCompare(right.id))

      const queueViewSeeded = await worker.evaluate(async (expectedTasks: Array<{ id: string; status: string }>) => {
        const result = await chrome.storage.session.get('queueView')
        const rawQueueView = result.queueView
        const queueView = Array.isArray(rawQueueView) ? rawQueueView : []
        const normalizedQueueView = queueView
          .map((task) => ({
            id: typeof task?.id === 'string' ? task.id : null,
            status: typeof task?.status === 'string' ? task.status : null,
          }))
          .filter((task): task is { id: string; status: string } => task.id !== null && task.status !== null)
          .sort((left, right) => left.id.localeCompare(right.id))

        const statusMatches = (expectedStatus: string | undefined, actualStatus: string | undefined): boolean => {
          if (expectedStatus === actualStatus) {
            return true
          }

          return expectedStatus === 'queued' && actualStatus === 'downloading'
        }

        return normalizedQueueView.length === expectedTasks.length
          && normalizedQueueView.every((task, index) => {
            const expectedTask = expectedTasks[index]
            return task.id === expectedTask?.id && statusMatches(expectedTask?.status, task.status)
          })
      }, expectedQueueView)

      if (!queueViewSeeded) {
        throw new Error('queueView not seeded yet')
      }

      return
    } catch (error) {
      if (attempt === 2) throw error
    }
  }
}

export { getExtensionWorker }

import type { BrowserContext, Worker } from "@playwright/test"

import { seedDownloadQueueStateInContext } from "./state-helpers"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type {
  DownloadTaskState,
  TaskChapter,
} from "../../../src/domain/queue/state"

function isBackgroundWorkerUrl(url: string): boolean {
  return (
    url.startsWith("chrome-extension://") && /\/background(?:\.js)?$/i.test(url)
  )
}

export function makeChapter(
  url: string,
  status: TaskChapter["status"],
  index: number = 1
): TaskChapter {
  return {
    id: url,
    url,
    title: url,
    index,
    status,
    lastUpdated: Date.now(),
  }
}

export function makeTask(
  partial: Partial<DownloadTaskState> & {
    id: string
    seriesTitle: string
    status: DownloadTaskState["status"]
    created: number
  }
): DownloadTaskState {
  const siteIntegrationId = partial.siteIntegrationId ?? "mangadex"
  const base: DownloadTaskState = {
    id: partial.id,
    siteIntegrationId,
    mangaId: "mangadex:series-1",
    seriesTitle: partial.seriesTitle,
    chapters: [makeChapter(`${partial.id}-chapter-1`, "queued")],
    status: partial.status,
    created: partial.created,
    settingsSnapshot: createTaskSettingsSnapshot(
      DEFAULT_SETTINGS,
      siteIntegrationId
    ),
  }

  return {
    ...base,
    ...partial,
  }
}

async function getExtensionWorker(context: BrowserContext): Promise<Worker> {
  const expectedName = "Tako Manga Downloader"
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
    const candidates = context
      .serviceWorkers()
      .filter((sw) => sw.url().startsWith("chrome-extension://"))
    for (const sw of candidates) {
      if (await isOurWorker(sw)) {
        worker = sw
        break
      }
    }
    if (worker) break

    try {
      await context.waitForEvent("serviceworker", {
        timeout: 1000,
        predicate: (sw) => sw.url().startsWith("chrome-extension://"),
      })
    } catch {
      void 0
    }
  }

  if (!worker) {
    throw new Error("Service worker not found")
  }

  return worker
}

export async function seedGlobalQueue(
  context: BrowserContext,
  tasks: DownloadTaskState[]
): Promise<void> {
  await seedDownloadQueueStateInContext(context, tasks)
}

export { getExtensionWorker }

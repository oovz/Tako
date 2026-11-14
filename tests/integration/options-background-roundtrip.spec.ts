import { afterEach, describe, expect, it, vi } from "vitest"

import { createBackgroundRuntimeMessageHandlers } from "@/entrypoints/background/background-runtime-message-handlers"
import { OptionsConfigurationService } from "@/entrypoints/background/options-configuration-service"
import { OptionsConfigurationClient } from "@/entrypoints/options/controllers/options-configuration-client"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { DownloadedChapterRecord } from "@/src/domain/history/types"
import { dispatchRuntimeMessage } from "@/src/runtime/runtime-message-dispatcher"
import { classifyRuntimeMessagePrincipal } from "@/src/runtime/runtime-message-sender"
import type {
  RuntimeMessage,
  RuntimeMessageReadiness,
} from "@/src/runtime/runtime-message-contracts"
import { HistoryRepository } from "@/src/storage/history-repository"
import { OptionsConfigurationRepository } from "@/src/storage/options-configuration-repository"
import {
  SETTINGS_STORAGE_KEY,
  SettingsRepository,
} from "@/src/storage/settings-repository"
import { applySettingsSideEffects } from "@/src/storage/settings-subscriber"
import { SiteIntegrationEnablementService } from "@/src/storage/site-integration-enablement-service"

function outsideOptionsScope(): never {
  throw new Error("Unexpected dependency outside the Options message workflow")
}

function createHarness() {
  const extensionId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  const stored: Record<string, unknown> = {
    [SETTINGS_STORAGE_KEY]: structuredClone(DEFAULT_SETTINGS),
    siteOverrides: { mangadex: { imagePolicy: { concurrency: 3 } } },
    siteIntegrationEnablement: { mangadex: false },
    siteIntegrationSettings: { mangadex: { imageQuality: "data-saver" } },
  }
  const storage = {
    get: vi.fn(async (keys: string | string[]) =>
      Object.fromEntries(
        [keys]
          .flat()
          .filter((key) => key in stored)
          .map((key) => [key, structuredClone(stored[key])])
      )
    ),
    set: vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(stored, structuredClone(values))
    }),
  }
  const settings = new SettingsRepository("warn")
  const history = new HistoryRepository()
  const configuration = new OptionsConfigurationRepository(storage, settings)
  const service = new OptionsConfigurationService({
    configurationRepository: configuration,
    settingsRepository: settings,
    historyRepository: history,
    applySettingsSideEffects,
    cleanupRateLimiters: () => undefined,
    collectUnusedHandles: async () => undefined,
  })
  const handlers = createBackgroundRuntimeMessageHandlers({
    get rateLimitService() {
      return outsideOptionsScope()
    },
    settingsRepository: settings,
    historyRepository: history,
    optionsConfigurationService: service,
    siteIntegrationEnablementService: new SiteIntegrationEnablementService(),
    coverPreviewHandlers: {
      GET_COVER_PREVIEW: outsideOptionsScope,
      CANCEL_COVER_PREVIEW: outsideOptionsScope,
    },
    get queueRepository() {
      return outsideOptionsScope()
    },
    get queueApplicationCommands() {
      return outsideOptionsScope()
    },
    get nativeOutputCoordinator() {
      return outsideOptionsScope()
    },
    get terminalCoordinator() {
      return outsideOptionsScope()
    },
    get downloadStateQueryService() {
      return outsideOptionsScope()
    },
    ensureOffscreenDocumentReady: outsideOptionsScope,
    tabContextResolver: { resolveTabContext: outsideOptionsScope },
  })
  const ready = Promise.withResolvers<void>()
  const enteredReadiness = Promise.withResolvers<void>()
  const waitForReadiness = vi.fn((phase: RuntimeMessageReadiness) => {
    if (phase !== "runtime-ready")
      throw new Error(`Unexpected Options readiness phase: ${phase}`)
    enteredReadiness.resolve()
    return ready.promise
  })
  const sender: chrome.runtime.MessageSender = {
    id: extensionId,
    url: `chrome-extension://${extensionId}/options.html`,
  }
  vi.stubGlobal("chrome", {
    storage: { local: storage },
    i18n: { getUILanguage: () => "en", getMessage: (key: string) => key },
    runtime: {
      id: extensionId,
      getURL: (path: string) => `chrome-extension://${extensionId}/${path}`,
      sendMessage: (message: RuntimeMessage) =>
        dispatchRuntimeMessage(message, sender, {
          target: "background",
          handlers,
          classifySender: (source) =>
            classifyRuntimeMessagePrincipal(source, extensionId),
          waitForReadiness,
        }),
    },
  })
  return {
    client: new OptionsConfigurationClient(),
    history,
    settings,
    storage,
    ready,
    enteredReadiness,
    waitForReadiness,
    coldConfiguration: () =>
      new OptionsConfigurationRepository(
        storage,
        new SettingsRepository("warn")
      ),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe("Options client background round trips", () => {
  it("loads usable authoritative configuration after readiness and saves a valid edited document durably", async () => {
    const harness = createHarness()
    const loading = harness.client.load()
    await harness.enteredReadiness.promise
    expect(harness.storage.get).not.toHaveBeenCalled()
    harness.ready.resolve()
    await expect(loading).resolves.toMatchObject({
      configuration: {
        settings: { notifications: DEFAULT_SETTINGS.notifications },
        overrides: { mangadex: { imagePolicy: { concurrency: 3 } } },
        enablement: { mangadex: false },
        integrationSettings: { mangadex: { imageQuality: "data-saver" } },
      },
      historyStats: { totalChapters: 0, totalSeries: 0 },
      historySeries: [],
    })
    const submitted = (await loading).configuration
    submitted.settings.notifications = !DEFAULT_SETTINGS.notifications
    submitted.settings.downloads.pathTemplate = "Edited/<SERIES_TITLE>"
    submitted.overrides.mangadex.imagePolicy = { delayMs: 125 }
    submitted.enablement["pixiv-comic"] = false
    submitted.integrationSettings.mangadex.imageQuality = "data"

    await expect(harness.client.save(submitted)).resolves.toEqual(submitted)

    await expect(harness.coldConfiguration().get()).resolves.toEqual(submitted)
    await expect(harness.settings.getSettings()).resolves.toEqual(
      submitted.settings
    )
    await expect(harness.client.load()).resolves.toMatchObject({
      configuration: submitted,
    })
    expect(harness.waitForReadiness.mock.calls.map(([phase]) => phase)).toEqual(
      ["runtime-ready", "runtime-ready", "runtime-ready"]
    )
  })

  it("acknowledges committed series and all-history clears while preserving the other series", async () => {
    const harness = createHarness()
    harness.ready.resolve()
    const records: DownloadedChapterRecord[] = [
      {
        siteIntegrationId: "mangadex",
        seriesId: "series-a",
        chapterId: "chapter-a",
        seriesTitle: "Series A",
        title: "Chapter A",
        url: "https://mangadex.org/chapter/chapter-a",
        downloadedAt: 100,
        saveConfirmedAt: 100,
        outputDestination: "downloads-api",
        format: "cbz",
      },
      {
        siteIntegrationId: "pixiv-comic",
        seriesId: "series-b",
        chapterId: "chapter-b",
        seriesTitle: "Series B",
        title: "Chapter B",
        url: "https://comic.pixiv.net/works/series-b",
        downloadedAt: 200,
        saveConfirmedAt: 200,
        outputDestination: "downloads-api",
        format: "zip",
      },
    ]
    for (const record of records)
      await harness.history.markChapterAsDownloaded(record)
    const writeStarted = Promise.withResolvers<void>()
    const permitWrite = Promise.withResolvers<void>()
    const persist = harness.storage.set.getMockImplementation()!
    harness.storage.set.mockImplementationOnce(async (values) => {
      writeStarted.resolve()
      await permitWrite.promise
      await persist(values)
    })
    const acknowledged = vi.fn()
    const clearing = OptionsConfigurationClient.clearHistory({
      scope: "series",
      siteIntegrationId: "mangadex",
      seriesId: "series-a",
    })
    void clearing.then(acknowledged, () => undefined)
    await writeStarted.promise
    try {
      expect(acknowledged).not.toHaveBeenCalled()
      await expect(
        new HistoryRepository().getDownloadedChapters()
      ).resolves.toEqual(records)
    } finally {
      permitWrite.resolve()
    }
    await expect(clearing).resolves.toBeUndefined()
    expect(acknowledged).toHaveBeenCalledOnce()
    await expect(
      new HistoryRepository().getDownloadedChapters()
    ).resolves.toEqual([records[1]])
    await expect(harness.client.load()).resolves.toMatchObject({
      historyStats: { totalChapters: 1, totalSeries: 1 },
      historySeries: [
        {
          siteIntegrationId: "pixiv-comic",
          seriesId: "series-b",
          chapterCount: 1,
        },
      ],
    })

    await expect(
      OptionsConfigurationClient.clearHistory({ scope: "all" })
    ).resolves.toBeUndefined()

    await expect(
      new HistoryRepository().getDownloadedChapters()
    ).resolves.toEqual([])
    await expect(harness.client.load()).resolves.toMatchObject({
      historyStats: { totalChapters: 0, totalSeries: 0 },
      historySeries: [],
    })
  })
})

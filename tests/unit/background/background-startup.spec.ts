import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
import type { CentralizedStateManager } from '@/src/runtime/centralized-state'
import type { DownloadTaskState } from '@/src/types/queue-state'
import type { PendingDownloadsStore } from '@/entrypoints/background/pending-downloads'

const mocks = vi.hoisted(() => ({
  initializeBackgroundSiteIntegrations: vi.fn(async () => undefined),
  getSettings: vi.fn(async () => ({ downloads: { defaultFormat: 'cbz' } })),
  settingsSyncInitialize: vi.fn(),
  validateCustomFolderAccess: vi.fn(async () => ({ isValid: true, shouldFallback: false })),
  createStateManager: vi.fn(),
  initializeFromStorage: vi.fn<(dependencies: { readQueue: () => Promise<DownloadTaskState[]> }) => Promise<{ queue: DownloadTaskState[]; initFailed: boolean }>>(async () => ({ queue: [], initFailed: false })),
  processDownloadQueue: vi.fn(async () => undefined),
  hydratePendingDownloads: vi.fn(async () => undefined),
  updateGlobalState: vi.fn(async () => undefined),
  storageLocalGet: vi.fn<(key: string) => Promise<Record<string, unknown>>>(async () => ({ downloadQueue: [] })),
}))

vi.mock('@/src/runtime/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@/src/runtime/background-site-integration-initialization', () => ({
  initializeBackgroundSiteIntegrations: mocks.initializeBackgroundSiteIntegrations,
}))

vi.mock('@/src/storage/settings-service', () => ({
  settingsService: {
    getSettings: mocks.getSettings,
  },
}))

vi.mock('@/src/storage/settings-sync-service', () => ({
  settingsSyncService: {
    initialize: mocks.settingsSyncInitialize,
    validateCustomFolderAccess: mocks.validateCustomFolderAccess,
  },
}))

vi.mock('@/entrypoints/background/state-action-router', () => ({
  createStateManager: mocks.createStateManager,
}))

vi.mock('@/entrypoints/background/initialize-from-storage', () => ({
  initializeFromStorage: mocks.initializeFromStorage,
}))

vi.mock('@/entrypoints/background/download-queue', () => ({
  processDownloadQueue: mocks.processDownloadQueue,
}))

function createPendingDownloadsStoreStub(): PendingDownloadsStore {
  return {
    hydrate: mocks.hydratePendingDownloads,
    get: vi.fn(() => undefined),
    set: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    snapshot: vi.fn(() => new Map()),
  }
}

describe('initializeBackgroundRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: mocks.storageLocalGet,
        },
      },
    })

    mocks.createStateManager.mockResolvedValue({
      updateGlobalState: mocks.updateGlobalState,
    } satisfies Pick<CentralizedStateManager, 'updateGlobalState'>)
  })

  it('does not eagerly validate custom folder access during startup', async () => {
    const { initializeBackgroundRuntime } = await import('@/entrypoints/background/background-startup')

    const pendingDownloadsStore = createPendingDownloadsStoreStub()

    await initializeBackgroundRuntime({
      pendingDownloadsStore,
      ensureLivenessAlarm: async () => undefined,
      ensureOffscreenDocumentReady: async () => undefined,
    })

    expect(mocks.settingsSyncInitialize).toHaveBeenCalledTimes(1)
    expect(mocks.validateCustomFolderAccess).not.toHaveBeenCalled()
  })

  it('normalizes persisted queue entries before passing them into startup recovery', async () => {
    mocks.storageLocalGet.mockResolvedValue({
      downloadQueue: [
        {
          id: 'task-legacy',
          siteIntegrationId: 'test-site',
          mangaId: 'series-1',
          seriesTitle: 'Legacy Series',
          created: 1,
          status: 'queued',
          chapters: [
            {
              id: 'ch-1',
              url: 'https://example.com/ch-1',
              title: 'Chapter 1',
              status: 'queued',
              index: 0,
              lastUpdated: 1,
            },
          ],
          settingsSnapshot: {
            archiveFormat: 'rar',
            overwriteExisting: 'yes',
            pathTemplate: '',
            fileNameTemplate: '',
            includeComicInfo: 'true',
            includeCoverImage: 1,
          },
        },
        {
          invalid: true,
        },
      ],
    })

    mocks.initializeFromStorage.mockImplementationOnce(async (dependencies: { readQueue: () => Promise<DownloadTaskState[]> }) => {
      const { readQueue } = dependencies
      const queue = await readQueue()

      expect(queue).toHaveLength(1)
      expect(queue[0]).toEqual(
        expect.objectContaining({
          id: 'task-legacy',
          settingsSnapshot: expect.objectContaining({
            archiveFormat: DEFAULT_SETTINGS.downloads.defaultFormat,
            overwriteExisting: DEFAULT_SETTINGS.downloads.overwriteExisting,
            pathTemplate: DEFAULT_SETTINGS.downloads.pathTemplate,
            fileNameTemplate: DEFAULT_SETTINGS.downloads.fileNameTemplate,
            includeComicInfo: DEFAULT_SETTINGS.downloads.includeComicInfo,
            includeCoverImage: DEFAULT_SETTINGS.downloads.includeCoverImage,
          }),
        }),
      )

      return { queue, initFailed: false }
    })

    const { initializeBackgroundRuntime } = await import('@/entrypoints/background/background-startup')

    const pendingDownloadsStore = createPendingDownloadsStoreStub()

    await initializeBackgroundRuntime({
      pendingDownloadsStore,
      ensureLivenessAlarm: async () => undefined,
      ensureOffscreenDocumentReady: async () => undefined,
    })
  })
})

describe('configureImageRefererRewriteRules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('configures referer rewrite rules for image CDNs that reject extension-origin fetches', async () => {
    const updateSessionRules = vi.fn(async () => undefined)
    vi.stubGlobal('chrome', {
      declarativeNetRequest: {
        updateSessionRules,
        RuleActionType: {
          MODIFY_HEADERS: 'modifyHeaders',
        },
        HeaderOperation: {
          SET: 'set',
        },
        ResourceType: {
          XMLHTTPREQUEST: 'xmlhttprequest',
          OTHER: 'other',
        },
      },
    })

    const { configureImageRefererRewriteRules } = await import('@/entrypoints/background/background-startup')

    await configureImageRefererRewriteRules()

    expect(updateSessionRules).toHaveBeenCalledWith({
      removeRuleIds: [41001, 41002],
      addRules: expect.arrayContaining([
        expect.objectContaining({
          id: 41001,
          condition: expect.objectContaining({
            requestDomains: ['img-comic.pximg.net'],
          }),
        }),
        expect.objectContaining({
          id: 41002,
          action: expect.objectContaining({
            requestHeaders: [
              {
                header: 'referer',
                operation: 'set',
                value: 'https://www.manhuagui.com/',
              },
            ],
          }),
          condition: expect.objectContaining({
            requestDomains: [
              'i.hamreus.com',
              'eu.hamreus.com',
              'eu1.hamreus.com',
              'eu2.hamreus.com',
              'us.hamreus.com',
              'us1.hamreus.com',
              'us2.hamreus.com',
              'us3.hamreus.com',
            ],
          }),
        }),
      ]),
    })
  })
})


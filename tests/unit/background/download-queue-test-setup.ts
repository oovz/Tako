import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot';
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings';
import type { CentralizedStateManager } from '@/src/runtime/centralized-state';
import type { DownloadTaskState, GlobalAppState, TaskChapter } from '@/src/types/queue-state';
import type { MangaPageState, ChapterState } from '@/src/types/tab-state';
import { vi } from 'vitest';

vi.mock('@/entrypoints/background/queue-helpers', () => ({
  resolveDownloadPlan: vi.fn().mockResolvedValue({
    format: 'cbz',
    overwriteExisting: false,
    book: {
      siteId: 'test-site',
      seriesId: 'series-1',
      seriesTitle: 'Test Manga',
      comicInfoBase: { Series: 'Test Manga' },
    },
    chapters: [
      {
        id: 'ch1',
        url: 'https://example.com/ch1',
        title: 'Chapter 1',
        chapterNumber: 1,
        resolvedPath: '/downloads/Test Manga/Chapter 1.cbz',
      },
    ],
  }),
  validateDownloadPathForTask: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/src/runtime/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/src/runtime/rate-limit', () => ({
  resolveEffectivePolicy: vi.fn(),
  scheduleForIntegrationScope: vi.fn(),
}));

vi.mock('@/src/runtime/site-integration-registry', () => ({
  findSiteIntegrationForUrl: vi.fn(() => ({
    id: 'test-integration',
    name: 'Test Integration',
    version: '1.0.0',
    author: 'tester',
  })),
  siteIntegrationRegistry: {
    findById: vi.fn(() => null),
  },
}));

vi.mock('@/src/runtime/site-integration-initialization', () => ({
  getSiteIntegrationById: vi.fn().mockResolvedValue(undefined),
}));

export {
  completeDownloadTask,
  failDownloadTask,
  moveTaskToTop,
  processDownloadQueue,
  startDownloadTask,
} from '@/entrypoints/background/download-queue';

export let mockStateManager: CentralizedStateManager;
export let mockEnsureOffscreenReady: ReturnType<typeof vi.fn>;
export let mockRuntimeSendMessage: ReturnType<typeof vi.fn>;
export let mockGlobalState: GlobalAppState;
export let mockTabState: MangaPageState;

export const testSettings = {
  ...DEFAULT_SETTINGS,
  downloads: {
    ...DEFAULT_SETTINGS.downloads,
    pathTemplate: '/downloads',
    maxConcurrentChapters: 3,
  },
};

export const createChapter = (partial: Partial<ChapterState>): ChapterState => ({
  id: partial.id ?? (() => {
    const fallbackUrl = partial.url ?? 'https://example.com/ch1';
    try {
      return new URL(fallbackUrl).pathname.split('/').filter(Boolean).at(-1) ?? 'ch1';
    } catch {
      return fallbackUrl;
    }
  })(),
  url: partial.url || 'https://example.com/ch1',
  title: partial.title || 'Chapter 1',
  index: partial.index ?? 1,
  chapterNumber: partial.chapterNumber,
  status: partial.status || 'queued',
  lastUpdated: partial.lastUpdated || Date.now(),
  ...partial,
});

export const makeTask = (overrides: Partial<DownloadTaskState> = {}): DownloadTaskState => {
  const siteIntegrationId = overrides.siteIntegrationId ?? 'test-site';
  return {
    id: overrides.id ?? 'task-1',
    siteIntegrationId,
    mangaId: overrides.mangaId ?? 'series-1',
    seriesTitle: overrides.seriesTitle ?? 'Test Manga',
    chapters: overrides.chapters ?? [createChapter({ url: 'https://example.com/ch1', title: 'Chapter 1', chapterNumber: 1 })],
    status: overrides.status ?? 'queued',
    created: overrides.created ?? Date.now(),
    completed: overrides.completed,
    started: overrides.started,
    errorMessage: overrides.errorMessage,
    lastSuccessfulDownloadId: overrides.lastSuccessfulDownloadId,
    isRetried: overrides.isRetried,
    isRetryTask: overrides.isRetryTask,
    settingsSnapshot: overrides.settingsSnapshot ?? createTaskSettingsSnapshot(testSettings, siteIntegrationId),
  };
};

export async function resetDownloadQueueTestEnvironment(): Promise<void> {
  vi.clearAllMocks();

  mockGlobalState = {
    downloadQueue: [],
    lastActivity: Date.now(),
    settings: testSettings,
  };

  mockTabState = {
    siteIntegrationId: 'test-site',
    mangaId: 'series-1',
    seriesTitle: 'Test Manga',
    chapters: [],
    volumes: [],
    metadata: {},
    lastUpdated: Date.now(),
  };

  const updateDownloadTaskMock = vi.fn().mockImplementation(async (taskId: string, updates: Partial<DownloadTaskState>) => {
    const taskIndex = mockGlobalState.downloadQueue.findIndex(task => task.id === taskId);
    if (taskIndex >= 0) {
      mockGlobalState.downloadQueue[taskIndex] = {
        ...mockGlobalState.downloadQueue[taskIndex],
        ...updates,
      };
    }
  });

  const updateDownloadTaskChapterMock = vi.fn().mockImplementation(async (
    taskId: string,
    chapterId: string,
    status: TaskChapter['status'],
    updates?: { errorMessage?: string; totalImages?: number; imagesFailed?: number },
  ) => {
    const task = mockGlobalState.downloadQueue.find(t => t.id === taskId);
    const chapterIndex = task?.chapters.findIndex(c => c.id === chapterId) ?? -1;
    if (task && chapterIndex >= 0) {
      const chapter = task.chapters[chapterIndex];
      if (chapter) {
        task.chapters[chapterIndex] = {
          ...chapter,
          status,
          errorMessage: updates?.errorMessage,
          totalImages: updates?.totalImages ?? chapter.totalImages,
          imagesFailed: updates?.imagesFailed ?? chapter.imagesFailed,
          lastUpdated: Date.now(),
        };
      }
    }
  });

  mockStateManager = {
    getGlobalState: vi.fn().mockResolvedValue(mockGlobalState),
    getTabState: vi.fn().mockResolvedValue(mockTabState),
    updateDownloadTask: updateDownloadTaskMock,
    updateDownloadTaskChapter: updateDownloadTaskChapterMock,
    updateChapterState: vi.fn().mockResolvedValue(undefined),
    updateGlobalState: vi.fn().mockImplementation(async (updates: Partial<GlobalAppState>) => {
      mockGlobalState = {
        ...mockGlobalState,
        ...updates,
      };
    }),
  } as unknown as CentralizedStateManager;

  mockEnsureOffscreenReady = vi.fn().mockResolvedValue(undefined);
  mockRuntimeSendMessage = vi.fn().mockResolvedValue({ success: true, status: 'completed' });

  const chromeMock = {
    runtime: {
      sendMessage: mockRuntimeSendMessage,
    },
    storage: {
      session: {
        set: vi.fn(async () => undefined),
      },
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
    },
  };
  vi.stubGlobal('chrome', chromeMock);
  (globalThis as { chrome?: unknown }).chrome = chromeMock;

  const rateLimit = await import('@/src/runtime/rate-limit');
  const mockedResolvePolicy = vi.mocked(rateLimit.resolveEffectivePolicy);
  const mockedSchedule = vi.mocked(rateLimit.scheduleForIntegrationScope);

  mockedResolvePolicy.mockResolvedValue({ concurrency: 1, delayMs: 0 });
  mockedSchedule.mockImplementation(async (_integrationId: string, _scope: string, task: () => Promise<unknown>) => {
    return task();
  });
}

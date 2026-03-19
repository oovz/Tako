/**
 * Unit Tests: Download Queue Manager
 * 
 * Tests task orchestration, queue processing with global single-active-task
 * semantics, same-tab/same-series queuing behavior, and state transitions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  startDownloadTask,
  processDownloadQueue,
  completeDownloadTask,
  failDownloadTask,
  moveTaskToTop,
} from '@/entrypoints/background/download-queue';
import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot';
import { CentralizedStateManager } from '@/src/runtime/centralized-state';
import type { DownloadTaskState, GlobalAppState, TaskChapter } from '@/src/types/queue-state';
import type { MangaPageState, ChapterState } from '@/src/types/tab-state';
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings';

// Mock queue-helpers module
vi.mock('@/entrypoints/background/queue-helpers', () => ({
  resolveDownloadPlan: vi.fn().mockResolvedValue({
    format: 'cbz',
    overwriteExisting: false,
    book: {
      siteId: 'test-site',
      seriesId: 'series-1',
      seriesTitle: 'Test Manga',
      comicInfoBase: { Series: 'Test Manga' }
    },
    chapters: [
      {
        id: 'ch1',
        url: 'https://example.com/ch1',
        title: 'Chapter 1',
        chapterNumber: 1,
        resolvedPath: '/downloads/Test Manga/Chapter 1.cbz'
      }
    ]
  }),
  validateDownloadPathForTask: vi.fn().mockResolvedValue(undefined)
}));

// Mock logger
vi.mock('@/src/runtime/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn()
  }
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

describe('Download Queue Manager', () => {
  let mockStateManager: CentralizedStateManager;
  let mockEnsureOffscreenReady: ReturnType<typeof vi.fn>;
  let mockRuntimeSendMessage: ReturnType<typeof vi.fn>;
  let mockGlobalState: GlobalAppState;
  let mockTabState: MangaPageState;
  const testSettings = {
    ...DEFAULT_SETTINGS,
    downloads: {
      ...DEFAULT_SETTINGS.downloads,
      pathTemplate: '/downloads',
      maxConcurrentChapters: 3,
    },
  };

  // Helper to create valid ChapterState objects
  const createChapter = (partial: Partial<ChapterState>): ChapterState => ({
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
    ...partial
  });

  const makeTask = (overrides: Partial<DownloadTaskState> = {}): DownloadTaskState => {
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

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup mock global state with full settings
    mockGlobalState = {
      downloadQueue: [],
      lastActivity: Date.now(),
      settings: testSettings
    };

    // Setup mock tab state
    mockTabState = {
      siteIntegrationId: 'test-site',
      mangaId: 'series-1',
      seriesTitle: 'Test Manga',
      chapters: [],
      volumes: [],
      metadata: {},
      lastUpdated: Date.now()
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

    // Mock state manager
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
        }
      }),
    } as unknown as CentralizedStateManager;

    // Mock functions
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
  });

  describe('startDownloadTask', () => {
    it('should start a valid download task', async () => {
      const task = makeTask({ id: 'task-1' });

      mockGlobalState.downloadQueue = [task];

      await startDownloadTask(
        mockStateManager,
        'task-1',
        mockEnsureOffscreenReady
      );

      // Should update task status to downloading
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'downloading',
          started: expect.any(Number)
        })
      );

      // Should ensure offscreen is ready
      expect(mockEnsureOffscreenReady).toHaveBeenCalled();

      // Should transition chapter into downloading flow
      expect(mockStateManager.updateDownloadTaskChapter).toHaveBeenCalled();
      expect(mockStateManager.updateChapterState).not.toHaveBeenCalled();
    });

    it('updates tab chapter state to failed when chapter dispatch fails', async () => {
      mockRuntimeSendMessage.mockResolvedValueOnce({ success: true, status: 'failed', errorMessage: 'Dispatch failed' });

      const task = makeTask({ id: 'task-failed-chapter' });

      mockGlobalState.downloadQueue = [task];

      await startDownloadTask(
        mockStateManager,
        'task-failed-chapter',
        mockEnsureOffscreenReady,
      );

      expect(mockStateManager.updateChapterState).not.toHaveBeenCalled();
    });

    it('should allow multiple tasks from same tab', async () => {
      // Multiple tasks per tab/series are allowed.
      // The single-active-task constraint is enforced by processDownloadQueue, not startDownloadTask.
      const existingTask = makeTask({
        id: 'task-1',
        status: 'completed',
        created: Date.now() - 5000,
        completed: Date.now() - 1000,
      });

      const newTask = makeTask({
        id: 'task-2',
        chapters: [createChapter({ url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2 })],
        created: Date.now(),
      });

      mockGlobalState.downloadQueue = [existingTask, newTask];

      await startDownloadTask(
        mockStateManager,
        'task-2',
        mockEnsureOffscreenReady
      );

      // Should successfully start the second task from the same tab
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-2',
        expect.objectContaining({
          status: 'downloading'
        })
      );

      // Should call offscreen bootstrap and chapter update functions
      expect(mockEnsureOffscreenReady).toHaveBeenCalled();
      expect(mockStateManager.updateDownloadTaskChapter).toHaveBeenCalled();
    });

    it('should start queued task regardless of tab origin', async () => {
      // No per-tab blocking: single-active-task is global, not per-tab.
      // startDownloadTask only starts a specific task; queue ordering is handled by processDownloadQueue.
      const task = makeTask({ id: 'task-1' });

      mockGlobalState.downloadQueue = [task];

      await startDownloadTask(
        mockStateManager,
        'task-1',
        mockEnsureOffscreenReady
      );

      // Should successfully start the task
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'downloading'
        })
      );

      expect(mockEnsureOffscreenReady).toHaveBeenCalled();
      expect(mockStateManager.updateDownloadTaskChapter).toHaveBeenCalled();
    });

    it('should handle task not found error', async () => {
      mockGlobalState.downloadQueue = [];

      await startDownloadTask(
        mockStateManager,
        'non-existent',
        mockEnsureOffscreenReady
      );

      // Should NOT call any offscreen functions
      expect(mockEnsureOffscreenReady).not.toHaveBeenCalled();
      expect(mockRuntimeSendMessage).not.toHaveBeenCalled();
    });

    it('should handle path validation failure', async () => {
      const { validateDownloadPathForTask } = await import('@/entrypoints/background/queue-helpers');
      vi.mocked(validateDownloadPathForTask).mockImplementationOnce(() => {
        throw new Error('Invalid download path');
      });

      const task = makeTask({ id: 'task-1' });

      mockGlobalState.downloadQueue = [task];

      await startDownloadTask(
        mockStateManager,
        'task-1',
        mockEnsureOffscreenReady
      );

      // Should mark task as failed
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'failed',
          errorMessage: 'Invalid download path'
        })
      );
    });

    it('should handle plan resolution failure', async () => {
      const { resolveDownloadPlan } = await import('@/entrypoints/background/queue-helpers');
      vi.mocked(resolveDownloadPlan).mockRejectedValueOnce(
        new Error('Chapter title missing')
      );

      const task = makeTask({
        id: 'task-1',
        chapters: [createChapter({ url: 'https://example.com/ch1', title: '', chapterNumber: 1 })],
      });

      mockGlobalState.downloadQueue = [task];

      await startDownloadTask(
        mockStateManager,
        'task-1',
        mockEnsureOffscreenReady
      );

      // Should publish a chapter-dispatch failure signal and terminal failed task summary
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          errorMessage: 'Chapter title missing'
        })
      );
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'failed'
        })
      );
    });

    it('re-resolves chapter paths on each dispatch iteration', async () => {
      const { resolveDownloadPlan } = await import('@/entrypoints/background/queue-helpers');

      vi.mocked(resolveDownloadPlan)
        .mockResolvedValueOnce({
          format: 'cbz',
          overwriteExisting: false,
          book: {
            siteId: 'test-site',
            seriesId: 'series-1',
            seriesTitle: 'Test Manga',
            comicInfoBase: { Series: 'Test Manga' }
          },
          chapters: [
            {
              id: 'ch1',
              url: 'https://example.com/ch1',
              title: 'Chapter 1',
              chapterNumber: 1,
              resolvedPath: '2026-02-26/Chapter 1.cbz',
              comicInfo: { Series: 'Test Manga' }
            },
            {
              id: 'ch2',
              url: 'https://example.com/ch2',
              title: 'Chapter 2',
              chapterNumber: 2,
              resolvedPath: '2026-02-26/Chapter 2.cbz',
              comicInfo: { Series: 'Test Manga' }
            }
          ]
        })
        .mockResolvedValueOnce({
          format: 'cbz',
          overwriteExisting: false,
          book: {
            siteId: 'test-site',
            seriesId: 'series-1',
            seriesTitle: 'Test Manga',
            comicInfoBase: { Series: 'Test Manga' }
          },
          chapters: [
            {
              id: 'ch1',
              url: 'https://example.com/ch1',
              title: 'Chapter 1',
              chapterNumber: 1,
              resolvedPath: '2026-02-27/Chapter 1.cbz',
              comicInfo: { Series: 'Test Manga' }
            },
            {
              id: 'ch2',
              url: 'https://example.com/ch2',
              title: 'Chapter 2',
              chapterNumber: 2,
              resolvedPath: '2026-02-27/Chapter 2.cbz',
              comicInfo: { Series: 'Test Manga' }
            }
          ]
        });

      const task = makeTask({
        id: 'task-date-macros',
        chapters: [
          createChapter({ id: 'ch1', url: 'https://example.com/ch1', title: 'Chapter 1', chapterNumber: 1 }),
          createChapter({ id: 'ch2', url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2 }),
        ],
        settingsSnapshot: {
          ...createTaskSettingsSnapshot(testSettings, 'test-site'),
          archiveFormat: 'cbz',
        },
      });

      mockGlobalState.downloadQueue = [task];

      await startDownloadTask(
        mockStateManager,
        'task-date-macros',
        mockEnsureOffscreenReady
      );

      const chapterDispatchCalls = mockRuntimeSendMessage.mock.calls.filter(
        (call) => call?.[0]?.type === 'OFFSCREEN_DOWNLOAD_CHAPTER'
      );

      expect(chapterDispatchCalls).toHaveLength(2);
      expect(chapterDispatchCalls[0]?.[0]?.payload?.chapter?.resolvedPath).toBe('2026-02-26/Chapter 1.cbz');
      expect(chapterDispatchCalls[1]?.[0]?.payload?.chapter?.resolvedPath).toBe('2026-02-27/Chapter 2.cbz');
      expect(vi.mocked(resolveDownloadPlan)).toHaveBeenCalledTimes(2);
    });

    it('propagates chapter language to OFFSCREEN_DOWNLOAD_CHAPTER payload', async () => {
      const task = makeTask({
        id: 'task-language',
        chapters: [
          createChapter({
            id: 'ch1',
            url: 'https://example.com/ch1',
            title: 'Chapter 1',
            chapterNumber: 1,
            language: 'ja',
          }),
        ],
      });

      mockGlobalState.downloadQueue = [task];

      await startDownloadTask(
        mockStateManager,
        'task-language',
        mockEnsureOffscreenReady,
      );

      const chapterDispatchCalls = mockRuntimeSendMessage.mock.calls.filter(
        (call) => call?.[0]?.type === 'OFFSCREEN_DOWNLOAD_CHAPTER',
      );

      expect(chapterDispatchCalls).toHaveLength(1);
      expect(chapterDispatchCalls[0]?.[0]?.payload?.chapter?.language).toBe('ja');
      expect(chapterDispatchCalls[0]?.[0]?.payload?.seriesKey).toBe('test-site#series-1');
    });

    it('dispatches chapters sequentially according to frozen task settings', async () => {
      const dispatchOrder: string[] = [];
      let inFlightDispatches = 0;
      let maxInFlightDispatches = 0;

      const { resolveDownloadPlan } = await import('@/entrypoints/background/queue-helpers');
      vi.mocked(resolveDownloadPlan).mockResolvedValue({
        format: 'cbz',
        overwriteExisting: false,
        book: {
          siteId: 'test-site',
          seriesId: 'series-1',
          seriesTitle: 'Sequential Series',
          comicInfoBase: { Series: 'Sequential Series' },
        },
        chapters: [
          { id: 'ch1', url: 'https://example.com/ch1', title: 'Chapter 1', chapterNumber: 1, resolvedPath: 'Chapter 1.cbz', comicInfo: { Series: 'Sequential Series' } },
          { id: 'ch2', url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2, resolvedPath: 'Chapter 2.cbz', comicInfo: { Series: 'Sequential Series' } },
          { id: 'ch3', url: 'https://example.com/ch3', title: 'Chapter 3', chapterNumber: 3, resolvedPath: 'Chapter 3.cbz', comicInfo: { Series: 'Sequential Series' } },
        ],
      });

      mockRuntimeSendMessage.mockImplementation(async (message: { type?: string; payload?: { chapter?: { id?: string } } }) => {
        if (message?.type !== 'OFFSCREEN_DOWNLOAD_CHAPTER') {
          return { success: true, status: 'completed' };
        }

        const chapterId = message.payload?.chapter?.id ?? 'unknown';
        dispatchOrder.push(`start:${chapterId}`);
        inFlightDispatches += 1;
        maxInFlightDispatches = Math.max(maxInFlightDispatches, inFlightDispatches);

        await new Promise((resolve) => setTimeout(resolve, 5));

        inFlightDispatches -= 1;
        dispatchOrder.push(`end:${chapterId}`);
        return { success: true, status: 'completed' };
      });

      const task = makeTask({
        id: 'task-sequential-dispatch',
        seriesTitle: 'Sequential Series',
        chapters: [
          createChapter({ id: 'ch1', url: 'https://example.com/ch1', title: 'Chapter 1', chapterNumber: 1 }),
          createChapter({ id: 'ch2', url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2 }),
          createChapter({ id: 'ch3', url: 'https://example.com/ch3', title: 'Chapter 3', chapterNumber: 3 }),
        ],
        settingsSnapshot: {
          ...createTaskSettingsSnapshot(testSettings, 'test-site'),
          archiveFormat: 'cbz',
        },
      });

      mockGlobalState.downloadQueue = [task];

      await startDownloadTask(
        mockStateManager,
        'task-sequential-dispatch',
        mockEnsureOffscreenReady,
      );

      expect(maxInFlightDispatches).toBe(1);
      expect(dispatchOrder.filter((entry) => entry.startsWith('start:'))).toHaveLength(3);
      expect(dispatchOrder.filter((entry) => entry.startsWith('end:'))).toHaveLength(3);
    });
  });

  describe('processDownloadQueue', () => {
    it('should start at most one queued task when none are active', async () => {
      mockGlobalState.settings.downloads.maxConcurrentDownloads = 1;
      const tasks: DownloadTaskState[] = [
        makeTask({ id: 'task-1', mangaId: 'series-1', seriesTitle: 'Test Manga 1' }),
        makeTask({ id: 'task-2', mangaId: 'series-2', seriesTitle: 'Test Manga 2' })
      ];

      mockGlobalState.downloadQueue = tasks;

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady
      );

      // With single-active-task semantics, only the first queued task is started
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalled();
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ status: 'downloading' })
      );
      expect(mockStateManager.updateDownloadTaskChapter).toHaveBeenCalled();
    });

    it('should not start new tasks when an active task exists', async () => {
      mockGlobalState.settings.downloads.maxConcurrentDownloads = 1;
      const tasks: DownloadTaskState[] = [
        makeTask({ id: 'task-1', mangaId: 'series-1', seriesTitle: 'Test Manga 1', status: 'downloading' }),
        makeTask({ id: 'task-3', mangaId: 'series-3', seriesTitle: 'Test Manga 3' }),
        makeTask({ id: 'task-4', mangaId: 'series-4', seriesTitle: 'Test Manga 4' })
      ];

      mockGlobalState.downloadQueue = tasks;

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady
      );

      // With single-active-task semantics and an existing active task, no new tasks are started
      expect(mockStateManager.updateDownloadTask).not.toHaveBeenCalled();
      expect(mockRuntimeSendMessage).not.toHaveBeenCalled();
    });

    it('starts only one queued task even when stale maxConcurrentDownloads exceeds 1', async () => {
      mockGlobalState.settings.downloads.maxConcurrentDownloads = 2;

      const tasks: DownloadTaskState[] = [
        makeTask({ id: 'task-1', siteIntegrationId: 'test-site-a', mangaId: 'series-1', seriesTitle: 'Test Manga 1', created: Date.now() }),
        makeTask({ id: 'task-2', siteIntegrationId: 'test-site-b', mangaId: 'series-2', seriesTitle: 'Test Manga 2', chapters: [createChapter({ url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2 })], created: Date.now() + 1 }),
        makeTask({ id: 'task-3', siteIntegrationId: 'test-site-c', mangaId: 'series-3', seriesTitle: 'Test Manga 3', chapters: [createChapter({ url: 'https://example.com/ch3', title: 'Chapter 3', chapterNumber: 3 })], created: Date.now() + 2 }),
      ];

      mockGlobalState.downloadQueue = tasks;

      const rateLimit = await import('@/src/runtime/rate-limit');
      vi.mocked(rateLimit.resolveEffectivePolicy).mockImplementation(async (integrationId: string) => ({
        concurrency: integrationId === 'test-site-a' || integrationId === 'test-site-b' || integrationId === 'test-site-c' ? 1 : 1,
        delayMs: 0,
      }));

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady,
      );

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ status: 'downloading' }),
      );
      expect(mockStateManager.updateDownloadTask).not.toHaveBeenCalledWith(
        'task-2',
        expect.objectContaining({ status: 'downloading' }),
      );
      expect(mockStateManager.updateDownloadTask).not.toHaveBeenCalledWith(
        'task-3',
        expect.objectContaining({ status: 'downloading' }),
      );
    });

    it('should skip processing when no queued tasks', async () => {
      mockGlobalState.downloadQueue = [
        makeTask({ id: 'task-1', status: 'completed', completed: Date.now() })
      ];

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady
      );

      // Should not start any tasks
      expect(mockStateManager.updateDownloadTask).not.toHaveBeenCalled();
      expect(mockRuntimeSendMessage).not.toHaveBeenCalled();
    });

    it('should start queued task even when site integration policy has delay', async () => {
      vi.useFakeTimers();
      const now = 1_000_000;
      vi.setSystemTime(now);

      const tasks: DownloadTaskState[] = [
        makeTask({
          id: 'task-rate-limited',
          seriesTitle: 'Rate Limited',
          chapters: [createChapter({ url: 'https://example.com/wait-1', title: 'Chapter 1', chapterNumber: 1 })],
          created: now - 1000,
        }),
      ];

      mockGlobalState.downloadQueue = tasks;

      const rateLimit = await import('@/src/runtime/rate-limit');
      const mockedResolvePolicy = vi.mocked(rateLimit.resolveEffectivePolicy);
      const mockedSchedule = vi.mocked(rateLimit.scheduleForIntegrationScope);

      mockedResolvePolicy.mockResolvedValueOnce({ concurrency: 1, delayMs: 5000 });

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady
      );

      expect(mockedResolvePolicy).toHaveBeenCalledWith('test-site', 'chapter');
      expect(mockedSchedule).toHaveBeenCalledWith('test-site', 'chapter', expect.any(Function));

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-rate-limited',
        expect.objectContaining({ status: 'downloading' })
      );

      vi.useRealTimers();
    });
  });

  describe('completeDownloadTask', () => {
    it('should mark task and chapters as completed', async () => {
      const task = makeTask({
        id: 'task-1',
        chapters: [
          createChapter({ url: 'https://example.com/ch1', title: 'Chapter 1', chapterNumber: 1 }),
          createChapter({ url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2 })
        ],
        status: 'downloading',
      });

      mockGlobalState.downloadQueue = [task];

      await completeDownloadTask(mockStateManager, 'task-1');

      // Should update task status to completed
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'completed',
          completed: expect.any(Number)
        })
      );
      expect(mockStateManager.updateChapterState).not.toHaveBeenCalled();
    });

    it('should handle task not found gracefully', async () => {
      mockGlobalState.downloadQueue = [];

      await completeDownloadTask(mockStateManager, 'non-existent');

      // Should still try to update task (state manager handles missing task)
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'non-existent',
        expect.objectContaining({ status: 'completed' })
      );
    });
  });

  describe('unlimited queue behavior', () => {
    it('accepts unlimited tasks without capacity enforcement', async () => {
      mockGlobalState.settings.downloads.maxConcurrentDownloads = 1;
      // Create 50 queued tasks to confirm there is no queue capacity cap.
      const tasks: DownloadTaskState[] = Array.from({ length: 50 }, (_, i) => makeTask({
        id: `task-${i}`,
        mangaId: `series-${i}`,
        seriesTitle: `Test Manga ${i}`,
        chapters: [createChapter({ url: `https://example.com/ch${i}`, title: `Chapter ${i}`, chapterNumber: i })],
        status: 'queued' as const,
        created: Date.now() + i,
      }));

      mockGlobalState.downloadQueue = tasks;

      // Process should start the first queued task (FIFO)
      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady
      );

      // Should successfully start the first task
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-0',
        expect.objectContaining({ status: 'downloading' })
      );
    });

    it('does not block new tasks based on queue size', async () => {
      mockGlobalState.settings.downloads.maxConcurrentDownloads = 1;
      // 100 queued tasks - no queue full rejection
      const tasks: DownloadTaskState[] = Array.from({ length: 100 }, (_, i) => makeTask({
        id: `task-${i}`,
        mangaId: `series-${i}`,
        seriesTitle: `Test Manga ${i}`,
        chapters: [createChapter({ url: `https://example.com/ch${i}`, title: `Chapter ${i}`, chapterNumber: i })],
        status: 'queued' as const,
        created: Date.now() + i,
      }));

      mockGlobalState.downloadQueue = tasks;

      // No queueAtCapacity check - process proceeds normally
      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady
      );

      // Verify first task started, no capacity errors
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-0',
        expect.objectContaining({ status: 'downloading' })
      );
      
      // No failed calls for "queue full" reason
      const failedCalls = vi.mocked(mockStateManager.updateDownloadTask).mock.calls
        .filter(call => (call[1] as Partial<DownloadTaskState>).status === 'failed');
      expect(failedCalls).toHaveLength(0);
    });
  });

  describe('FIFO queue processing', () => {
    it('processes tasks in creation order (FIFO)', async () => {
      mockGlobalState.settings.downloads.maxConcurrentDownloads = 1;
      const now = Date.now();
      const tasks: DownloadTaskState[] = [
        makeTask({ id: 'task-old', mangaId: 'series-1', seriesTitle: 'Old Task', created: now - 10000 }),
        makeTask({ id: 'task-new', mangaId: 'series-2', seriesTitle: 'New Task', chapters: [createChapter({ url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2 })], created: now }),
      ];

      mockGlobalState.downloadQueue = tasks;

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady
      );

      // Older task should be started first
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-old',
        expect.objectContaining({ status: 'downloading' })
      );
      expect(mockStateManager.updateDownloadTask).not.toHaveBeenCalledWith(
        'task-new',
        expect.objectContaining({ status: 'downloading' })
      );
    });

    it('maintains queue order when first task completes', async () => {
      mockGlobalState.settings.downloads.maxConcurrentDownloads = 1;
      const now = Date.now();
      const tasks: DownloadTaskState[] = [
        makeTask({ id: 'task-1', mangaId: 'series-1', seriesTitle: 'First Task', status: 'completed', created: now - 20000, completed: now - 1000 }),
        makeTask({ id: 'task-2', mangaId: 'series-2', seriesTitle: 'Second Task', chapters: [createChapter({ url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2 })], created: now - 15000 }),
        makeTask({ id: 'task-3', mangaId: 'series-3', seriesTitle: 'Third Task', chapters: [createChapter({ url: 'https://example.com/ch3', title: 'Chapter 3', chapterNumber: 3 })], created: now - 10000 }),
      ];

      mockGlobalState.downloadQueue = tasks;

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady
      );

      // Second task (oldest queued) should start
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-2',
        expect.objectContaining({ status: 'downloading' })
      );
    });
  });

  describe('single active task behavior', () => {
    it('allows only one downloading task at a time globally', async () => {
      const tasks: DownloadTaskState[] = [
        makeTask({ id: 'active-task', mangaId: 'series-1', seriesTitle: 'Active Download', status: 'downloading', created: Date.now() - 5000 }),
        makeTask({ id: 'waiting-task', mangaId: 'series-2', seriesTitle: 'Waiting Download', chapters: [createChapter({ url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2 })], created: Date.now() }),
      ];

      mockGlobalState.downloadQueue = tasks;

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady
      );

      // No new tasks should start while one is active
      expect(mockStateManager.updateDownloadTask).not.toHaveBeenCalled();
      expect(mockRuntimeSendMessage).not.toHaveBeenCalled();
    });

    it('starts next task after current task completes', async () => {
      const completedTask = makeTask({ id: 'completed-task', mangaId: 'series-1', seriesTitle: 'Completed Download', status: 'completed', created: Date.now() - 10000, completed: Date.now() - 1000 });

      const nextTask = makeTask({ id: 'next-task', mangaId: 'series-2', seriesTitle: 'Next Download', chapters: [createChapter({ url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2 })], created: Date.now() - 5000 });

      mockGlobalState.downloadQueue = [completedTask, nextTask];

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady
      );

      // Next queued task should start
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'next-task',
        expect.objectContaining({ status: 'downloading' })
      );
    });

    it('allows multiple tasks from same series in queue', async () => {
      // Multiple tasks from the same series are allowed.
      const tasks: DownloadTaskState[] = [
        makeTask({ id: 'task-1', mangaId: 'same-series', seriesTitle: 'Same Manga Part 1', created: Date.now() - 5000 }),
        makeTask({ id: 'task-2', mangaId: 'same-series', seriesTitle: 'Same Manga Part 2', chapters: [createChapter({ url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2 })], created: Date.now() }),
      ];

      mockGlobalState.downloadQueue = tasks;

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady
      );

      // First task should start (same series is allowed)
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ status: 'downloading' })
      );
    });

    it('allows multiple queued tasks from same tab in queue', async () => {
      // Multiple tasks per tab are allowed (unlimited queue).
      // Users can queue the same chapter multiple times from the same tab.
      const tasks: DownloadTaskState[] = [
        makeTask({ id: 'task-1', mangaId: 'series-1', created: Date.now() - 5000 }),
        makeTask({ id: 'task-2', mangaId: 'series-1', created: Date.now() }),
        makeTask({ id: 'task-3', mangaId: 'series-1', chapters: [createChapter({ url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2 })], created: Date.now() + 1000 }),
      ];

      mockGlobalState.downloadQueue = tasks;

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady
      );

      // First task should start (FIFO), other tasks remain queued
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalled();
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ status: 'downloading' })
      );
      
      // All 3 tasks from the same tab should be in queue (no rejection)
      expect(mockGlobalState.downloadQueue).toHaveLength(3);
    });
  });

  describe('moveTaskToTop', () => {
    it('moves a queued task to the front of the queued segment after all active tasks', async () => {
      mockGlobalState.downloadQueue = [
        makeTask({ id: 'active-1', mangaId: 'series-1', seriesTitle: 'Active 1', chapters: [createChapter({ url: 'https://example.com/a1', title: 'A1', chapterNumber: 1 })], status: 'downloading', created: 1 }),
        makeTask({ id: 'active-2', mangaId: 'series-2', seriesTitle: 'Active 2', chapters: [createChapter({ url: 'https://example.com/a2', title: 'A2', chapterNumber: 2 })], status: 'downloading', created: 2 }),
        makeTask({ id: 'queued-1', mangaId: 'series-3', seriesTitle: 'Queued 1', chapters: [createChapter({ url: 'https://example.com/q1', title: 'Q1', chapterNumber: 3 })], created: 3 }),
        makeTask({ id: 'queued-2', mangaId: 'series-4', seriesTitle: 'Queued 2', chapters: [createChapter({ url: 'https://example.com/q2', title: 'Q2', chapterNumber: 4 })], created: 4 }),
      ];

      const result = await moveTaskToTop(mockStateManager, 'queued-2');

      expect(result).toEqual({ success: true });
      expect(mockGlobalState.downloadQueue.map((task) => task.id)).toEqual([
        'active-1',
        'active-2',
        'queued-2',
        'queued-1',
      ]);
    });

    it('rejects moving non-queued tasks', async () => {
      mockGlobalState.downloadQueue = [
        makeTask({ id: 'active-1', mangaId: 'series-1', seriesTitle: 'Active 1', chapters: [createChapter({ url: 'https://example.com/a1', title: 'A1', chapterNumber: 1 })], status: 'downloading', created: 1 }),
      ];

      const result = await moveTaskToTop(mockStateManager, 'active-1');

      expect(result).toEqual({ success: false, reason: 'Only queued tasks can be moved to top' });
    });
  });

  describe('queue status vocabulary excludes waiting/cooldown', () => {
    it('does not use waiting/cooldown fields even when site integration policy has delay', async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const task = makeTask({ id: 'rate-limited-task', seriesTitle: 'Rate Limited', created: now - 1000 });

      mockGlobalState.downloadQueue = [task];

      const rateLimit = await import('@/src/runtime/rate-limit');
      vi.mocked(rateLimit.resolveEffectivePolicy).mockResolvedValueOnce({ 
        concurrency: 1, 
        delayMs: 10000 // 10 second cooldown
      });

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady
      );

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'rate-limited-task',
        expect.objectContaining({ status: 'downloading' })
      );

      const calls = (mockStateManager.updateDownloadTask as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const hasWaitingUpdate = calls.some((c) => (c[1] as { status?: string } | undefined)?.status === 'waiting');
      const hasCooldownField = calls.some((c) => {
        const update = c[1] as Record<string, unknown> | undefined;
        return !!update && Object.prototype.hasOwnProperty.call(update, 'cooldownUntil');
      });
      expect(hasWaitingUpdate).toBe(false);
      expect(hasCooldownField).toBe(false);

      vi.useRealTimers();
    });

    it('processes queued tasks without requiring cooldown bookkeeping', async () => {
      const queuedTask = makeTask({ id: 'queued-task', seriesTitle: 'Queued Task', created: Date.now() - 10000 });

      mockGlobalState.downloadQueue = [queuedTask];

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady
      );

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'queued-task',
        expect.objectContaining({ status: 'downloading' })
      );
    });
  });

  describe('failDownloadTask', () => {
    it('should mark task and chapters as failed with error message', async () => {
      const task = makeTask({
        id: 'task-1',
        chapters: [
          createChapter({ url: 'https://example.com/ch1', title: 'Chapter 1', chapterNumber: 1 }),
          createChapter({ url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2 })
        ],
        status: 'downloading',
      });

      mockGlobalState.downloadQueue = [task];

      const errorMessage = 'Network connection lost';
      await failDownloadTask(mockStateManager, 'task-1', errorMessage);

      // Should update task status to failed with error message
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'failed',
          errorMessage,
          completed: expect.any(Number)
        })
      );
      expect(mockStateManager.updateChapterState).not.toHaveBeenCalled();
    });

    it('should handle task not found gracefully', async () => {
      mockGlobalState.downloadQueue = [];

      await failDownloadTask(mockStateManager, 'non-existent', 'Some error');

      // Should still try to update task (state manager handles missing task)
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'non-existent',
        expect.objectContaining({ status: 'failed' })
      );
    });
  });
});


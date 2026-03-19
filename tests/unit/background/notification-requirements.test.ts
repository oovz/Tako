import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot';
import { LOCAL_STORAGE_KEYS } from '@/src/runtime/storage-keys';
import { NotificationManager } from '@/entrypoints/background/notification-manager';
import { addPersistentError, clearPersistentError, getPersistentErrors } from '@/entrypoints/background/errors';
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings';
import type { DownloadTaskState } from '@/src/types/queue-state';

vi.mock('@/src/runtime/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/src/site-integrations/manifest', () => ({
  getSiteIntegrationDisplayName: vi.fn(() => 'MangaDex'),
}));

function makeTask(overrides: Partial<DownloadTaskState> = {}): DownloadTaskState {
  const now = Date.now();
  const siteIntegrationId = overrides.siteIntegrationId ?? 'mangadex';
  return {
    id: overrides.id ?? 'task-1',
    siteIntegrationId,
    mangaId: overrides.mangaId ?? 'mangadex:series-1',
    seriesTitle: overrides.seriesTitle ?? 'Series 1',
    chapters: overrides.chapters ?? [],
    status: overrides.status ?? 'completed',
    created: overrides.created ?? now,
    completed: overrides.completed ?? now,
    lastSuccessfulDownloadId: overrides.lastSuccessfulDownloadId,
    settingsSnapshot: overrides.settingsSnapshot ?? createTaskSettingsSnapshot(DEFAULT_SETTINGS, siteIntegrationId),
  };
}

describe('notification behavior', () => {
  const notificationsCreate = vi.fn();
  const runtimeGetUrl = vi.fn((path: string) => `chrome-extension://test/${path}`);
  const onClickedAddListener = vi.fn();
  const onClosedAddListener = vi.fn();
  const downloadsShow = vi.fn();
  const notificationsClear = vi.fn();
  const storageLocalGet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    storageLocalGet.mockResolvedValue({ [LOCAL_STORAGE_KEYS.downloadQueue]: [] });

    vi.stubGlobal('chrome', {
      runtime: {
        getURL: runtimeGetUrl,
      },
      storage: {
        local: {
          get: storageLocalGet,
        },
      },
      downloads: {
        show: downloadsShow,
      },
      notifications: {
        create: notificationsCreate,
        clear: notificationsClear,
        onClicked: { addListener: onClickedAddListener },
        onClosed: { addListener: onClosedAddListener },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates completion notification with iconUrl from runtime URL', () => {
    const manager = new NotificationManager();
    const task = makeTask({
      chapters: [{ id: 'ch-1', url: 'https://example.com/ch-1', title: 'Chapter 1', index: 1, status: 'completed', lastUpdated: Date.now() }],
    });

    manager.notifyTaskCompleted({ task, notificationsEnabled: true, chaptersCompleted: 1, chaptersTotal: 1 });

    expect(runtimeGetUrl).toHaveBeenCalledWith('icon/128.png');
    expect(notificationsCreate).toHaveBeenCalledWith(
      `task_complete_${task.id}`,
      expect.objectContaining({
        type: 'basic',
        iconUrl: 'chrome-extension://test/icon/128.png',
        title: 'Download complete',
      }),
    );
  });

  it('does not create notification when notifications are disabled', () => {
    const manager = new NotificationManager();
    const task = makeTask();

    manager.notifyTaskCompleted({ task, notificationsEnabled: false });

    expect(notificationsCreate).not.toHaveBeenCalled();
  });

  it('resolves notification click targets from persisted queue state', async () => {
    const task = makeTask({
      id: 'task-click',
      lastSuccessfulDownloadId: 321,
      chapters: [{ id: 'ch-1', url: 'https://example.com/ch-1', title: 'Chapter 1', index: 1, status: 'completed', lastUpdated: Date.now() }],
    });
    storageLocalGet.mockResolvedValue({ [LOCAL_STORAGE_KEYS.downloadQueue]: [task] });

    const manager = new NotificationManager();
    manager.notifyTaskCompleted({ task, notificationsEnabled: true, chaptersCompleted: 1, chaptersTotal: 1 });

    const clickHandler = onClickedAddListener.mock.calls[0]?.[0] as ((notificationId: string) => void) | undefined;
    expect(clickHandler).toBeTypeOf('function');

    clickHandler?.(`task_complete_${task.id}`);

    await Promise.resolve();
    await Promise.resolve();

    expect(storageLocalGet).toHaveBeenCalledWith(LOCAL_STORAGE_KEYS.downloadQueue);
    expect(downloadsShow).toHaveBeenCalledWith(321);
    expect(notificationsClear).toHaveBeenCalledWith(`task_complete_${task.id}`);
  });
});

describe('settings and persistent error behavior', () => {
  const storageLocalGet = vi.fn();
  const storageLocalSet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    storageLocalGet.mockResolvedValue({ persistent_errors: [] });
    storageLocalSet.mockResolvedValue(undefined);

    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: storageLocalGet,
          set: storageLocalSet,
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults overwriteExisting to false', () => {
    expect(DEFAULT_SETTINGS.downloads.overwriteExisting).toBe(false);
  });

  it('adds and clears persistent error entries by code', async () => {
    storageLocalGet
      .mockResolvedValueOnce({ persistent_errors: [] })
      .mockResolvedValueOnce({ persistent_errors: [{ code: 'FSA_HANDLE_INVALID', message: 'invalid', severity: 'error', ts: 1 }] })
      .mockResolvedValueOnce({ persistent_errors: [] });

    await addPersistentError({ code: 'FSA_HANDLE_INVALID', message: 'invalid', severity: 'error', ts: 1 });
    await clearPersistentError('FSA_HANDLE_INVALID');

    const errors = await getPersistentErrors();
    expect(errors).toEqual([]);
    expect(storageLocalSet).toHaveBeenCalledTimes(2);
  });
});


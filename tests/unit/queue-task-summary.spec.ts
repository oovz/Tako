import { describe, it, expect } from 'vitest';

import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot';
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings';
import { toQueueTaskSummary } from '@/src/runtime/queue-task-summary';
import type { DownloadTaskState, QueueTaskSummary, TaskChapter } from '@/src/types/queue-state';

 function toRecord(summary: QueueTaskSummary): Record<string, unknown> {
   return summary as unknown as Record<string, unknown>;
 }

function makeChapter(url: string, status: TaskChapter['status'], overrides: Partial<TaskChapter> = {}): TaskChapter {
  return {
    id: overrides.id ?? url,
    url,
    title: overrides.title ?? url,
    index: overrides.index ?? 1,
    status,
    lastUpdated: 0,
    ...overrides,
  } as TaskChapter;
}

function makeSettingsSnapshot(siteIntegrationId: string): DownloadTaskState['settingsSnapshot'] {
  return createTaskSettingsSnapshot(DEFAULT_SETTINGS, siteIntegrationId);
}

function makeTask(overrides: Partial<DownloadTaskState> = {}): DownloadTaskState {
  const siteIntegrationId = overrides.siteIntegrationId ?? 'mangadex';
  const base: DownloadTaskState = {
    id: 'task-1',
    siteIntegrationId,
    mangaId: 'mangadex:123',
    seriesTitle: 'Test Series',
    chapters: [],
    status: 'queued',
    created: 0,
    settingsSnapshot: makeSettingsSnapshot(siteIntegrationId),
  };

  return {
    ...base,
    ...overrides,
    settingsSnapshot: overrides.settingsSnapshot ?? makeSettingsSnapshot(overrides.siteIntegrationId ?? siteIntegrationId),
  } as DownloadTaskState;
}

describe('toQueueTaskSummary', () => {
  it('projects basic fields and preserves canonical queued status', () => {
    const task = makeTask({
      id: 'abc',
      siteIntegrationId: 'integration-x',
      seriesTitle: 'My Series',
      status: 'queued',
    });

    const summary = toQueueTaskSummary(task);

    expect(summary.id).toBe('abc');
    expect(summary.seriesTitle).toBe('My Series');
    expect(summary.seriesKey).toBe('integration-x#mangadex:123');
    expect(summary.siteIntegration).toBe('integration-x');
    expect(summary.status).toBe<'queued'>('queued');
    expect(summary.chapters.total).toBe(0);
    expect(summary.chapters.completed).toBe(0);
    expect(summary.chapters.unsuccessful).toBe(0);
    expect(summary.timestamps.created).toBe(0);
    expect(summary.timestamps.completed).toBeUndefined();

    const record = toRecord(summary);
    expect(record).not.toHaveProperty('siteId');
    expect(record).not.toHaveProperty('connectorSite');
    expect(record).not.toHaveProperty('progress');
    expect(record).not.toHaveProperty('progressPercent');
    expect(record).not.toHaveProperty('originTabId');
  });

  it('maps canonical task statuses', () => {
    const queued = toQueueTaskSummary(makeTask({ status: 'queued' }));
    const downloading = toQueueTaskSummary(makeTask({ status: 'downloading' }));
    const completed = toQueueTaskSummary(makeTask({ status: 'completed' }));
    const partial = toQueueTaskSummary(makeTask({ status: 'partial_success' }));
    const failed = toQueueTaskSummary(makeTask({ status: 'failed' }));
    const canceled = toQueueTaskSummary(makeTask({ status: 'canceled' }));

    expect(queued.status).toBe<'queued'>('queued');
    expect(downloading.status).toBe<'downloading'>('downloading');
    expect(completed.status).toBe<'completed'>('completed');
    expect(partial.status).toBe<'partial_success'>('partial_success');
    expect(failed.status).toBe<'failed'>('failed');
    expect(canceled.status).toBe<'canceled'>('canceled');
  });

  it('derives chapter counts from chapter statuses', () => {
    const chapters: TaskChapter[] = [
      makeChapter('c1', 'completed'),
      makeChapter('c2', 'failed'),
      makeChapter('c3', 'queued'),
      makeChapter('c4', 'downloading'),
    ];

    const task = makeTask({ chapters });
    const summary: QueueTaskSummary = toQueueTaskSummary(task);

    expect(summary.chapters.total).toBe(4);
    expect(summary.chapters.completed).toBe(1);
    expect(summary.chapters.unsuccessful).toBe(1);
  });

  it('treats partial_success chapters as unsuccessful for counts and retry', () => {
    const chapters: TaskChapter[] = [
      makeChapter('c1', 'completed'),
      makeChapter('c2', 'partial_success'),
      makeChapter('c3', 'failed'),
    ];

    const task = makeTask({ chapters, status: 'partial_success' as DownloadTaskState['status'] });
    const summary: QueueTaskSummary = toQueueTaskSummary(task);

    expect(summary.status).toBe<'partial_success'>('partial_success');
    expect(summary.chapters).toEqual({ total: 3, completed: 1, unsuccessful: 2 });
  });

  it('carries completed timestamp and failureReason from task', () => {
    const task = makeTask({
      status: 'failed',
      started: 100,
      completed: 200,
      errorMessage: 'Something went wrong',
    });

    const summary = toQueueTaskSummary(task);

    expect(summary.timestamps.completed).toBe(200);
    expect(summary.failureReason).toBe('Something went wrong');

    const record = toRecord(summary);
    expect(record).not.toHaveProperty('startedAt');
    expect(record).not.toHaveProperty('completedAt');
  });

  it('classifies failureCategory from errorMessage when possible', () => {
    const networkError = makeTask({
      status: 'failed',
      errorMessage: 'Network timeout while fetching page',
    });
    const downloadError = makeTask({
      status: 'failed',
      errorMessage: 'Chapter 4 failed to download archive file',
    });
    const otherError = makeTask({
      status: 'failed',
      errorMessage: 'Unexpected error',
    });

    const networkSummary = toQueueTaskSummary(networkError);
    const downloadSummary = toQueueTaskSummary(downloadError);
    const otherSummary = toQueueTaskSummary(otherError);

    expect(networkSummary.failureCategory).toBe<'network'>('network');
    expect(downloadSummary.failureCategory).toBe<'download'>('download');
    expect(otherSummary.failureCategory).toBeUndefined();
  });

  it('does not expose removed progress fields', () => {
    const summary = toQueueTaskSummary(makeTask());
    const record = toRecord(summary);

    expect(record).not.toHaveProperty('progress');
    expect(record).not.toHaveProperty('progressPercent');
  });

  it('handles tasks with no chapters gracefully', () => {
    const task = makeTask({ chapters: [] });
    const summary = toQueueTaskSummary(task);

    expect(summary.chapters).toEqual({ total: 0, completed: 0, unsuccessful: 0 });
  });

  it('does not project transient per-image fields into queue summary', () => {
    const task = makeTask({
      status: 'downloading',
    });

    const summary = toQueueTaskSummary(task);
    const record = toRecord(summary);

    expect(record).not.toHaveProperty('currentImageIndex');
    expect(record).not.toHaveProperty('totalImagesInChapter');
  });

  it('projects lastSuccessfulDownloadId instead of downloadId', () => {
    const task = {
      ...makeTask({
        status: 'completed',
      }),
      lastSuccessfulDownloadId: 12345,
    } as DownloadTaskState & { lastSuccessfulDownloadId: number };

    const summary = toQueueTaskSummary(task);
    const record = toRecord(summary);

    expect(summary.lastSuccessfulDownloadId).toBe(12345);
    expect(record).not.toHaveProperty('downloadId');
  });

  it('projects retry provenance from isRetried and retry/restart task ids', () => {
    const retriedTask = {
      ...makeTask({
        status: 'failed',
      }),
      isRetried: true,
    } as DownloadTaskState & { isRetried: boolean };
    const retryTask = makeTask({ id: 'retry-task-1', isRetryTask: true });
    const restartTask = makeTask({ id: 'restart-task-1', isRetryTask: true });

    const retriedSummary = toQueueTaskSummary(retriedTask);
    const retrySummary = toQueueTaskSummary(retryTask);
    const restartSummary = toQueueTaskSummary(restartTask);

    expect(retriedSummary.isRetried).toBe(true);
    expect(retrySummary.isRetried).toBe(false);
    expect(retrySummary.isRetryTask).toBe(true);
    expect(restartSummary.isRetryTask).toBe(true);
  });
});


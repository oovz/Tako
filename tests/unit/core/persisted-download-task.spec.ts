import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
import { normalizePersistedDownloadTask } from '@/src/runtime/persisted-download-task'

const DEFAULT_PATH_TEMPLATE = DEFAULT_SETTINGS.downloads.pathTemplate
const DEFAULT_FILE_NAME_TEMPLATE = DEFAULT_SETTINGS.downloads.fileNameTemplate
const DEFAULT_ARCHIVE_FORMAT = DEFAULT_SETTINGS.downloads.defaultFormat
const DEFAULT_INCLUDE_COMIC_INFO = DEFAULT_SETTINGS.downloads.includeComicInfo
const DEFAULT_INCLUDE_COVER_IMAGE = DEFAULT_SETTINGS.downloads.includeCoverImage ?? true
const DEFAULT_OVERWRITE_EXISTING = DEFAULT_SETTINGS.downloads.overwriteExisting

function createRawTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'task-1',
    siteIntegrationId: 'mangadex',
    mangaId: 'series-1',
    seriesTitle: 'Series 1',
    status: 'queued',
    created: 123,
    chapters: [
      {
        id: 'ch-1',
        url: 'https://example.com/ch-1',
        title: 'Chapter 1',
        index: 1,
        status: 'queued',
        lastUpdated: 456,
      },
    ],
    ...overrides,
  }
}

describe('normalizePersistedDownloadTask', () => {
  it('falls back to canonical snapshot defaults when legacy scalar fields are malformed', () => {
    const task = normalizePersistedDownloadTask(createRawTask({
      settingsSnapshot: {
        archiveFormat: 'rar',
        overwriteExisting: 'yes',
        pathTemplate: '',
        fileNameTemplate: '',
        includeComicInfo: 'true',
        includeCoverImage: 1,
      },
    }))

    expect(task).not.toBeNull()
    expect(task?.settingsSnapshot.archiveFormat).toBe(DEFAULT_ARCHIVE_FORMAT)
    expect(task?.settingsSnapshot.overwriteExisting).toBe(DEFAULT_OVERWRITE_EXISTING)
    expect(task?.settingsSnapshot.pathTemplate).toBe(DEFAULT_PATH_TEMPLATE)
    expect(task?.settingsSnapshot.fileNameTemplate).toBe(DEFAULT_FILE_NAME_TEMPLATE)
    expect(task?.settingsSnapshot.includeComicInfo).toBe(DEFAULT_INCLUDE_COMIC_INFO)
    expect(task?.settingsSnapshot.includeCoverImage).toBe(DEFAULT_INCLUDE_COVER_IMAGE)
  })

  it('preserves valid persisted scalar snapshot fields', () => {
    const task = normalizePersistedDownloadTask(createRawTask({
      settingsSnapshot: {
        archiveFormat: 'none',
        overwriteExisting: true,
        pathTemplate: 'Library/<SERIES_TITLE>',
        fileNameTemplate: '<SERIES_TITLE> - <CHAPTER_TITLE>',
        includeComicInfo: false,
        includeCoverImage: false,
      },
    }))

    expect(task).not.toBeNull()
    expect(task?.settingsSnapshot.archiveFormat).toBe('none')
    expect(task?.settingsSnapshot.overwriteExisting).toBe(true)
    expect(task?.settingsSnapshot.pathTemplate).toBe('Library/<SERIES_TITLE>')
    expect(task?.settingsSnapshot.fileNameTemplate).toBe('<SERIES_TITLE> - <CHAPTER_TITLE>')
    expect(task?.settingsSnapshot.includeComicInfo).toBe(false)
    expect(task?.settingsSnapshot.includeCoverImage).toBe(false)
  })

  it('drops stale lastSuccessfulDownloadId values for active persisted tasks', () => {
    const queuedTask = normalizePersistedDownloadTask(createRawTask({
      status: 'queued',
      lastSuccessfulDownloadId: 123,
    }))
    const downloadingTask = normalizePersistedDownloadTask(createRawTask({
      status: 'downloading',
      lastSuccessfulDownloadId: 456,
    }))
    const completedTask = normalizePersistedDownloadTask(createRawTask({
      status: 'completed',
      lastSuccessfulDownloadId: 789,
    }))

    expect(queuedTask?.lastSuccessfulDownloadId).toBeUndefined()
    expect(downloadingTask?.lastSuccessfulDownloadId).toBeUndefined()
    expect(completedTask?.lastSuccessfulDownloadId).toBe(789)
  })
})

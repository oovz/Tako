import { describe, expect, it, vi } from 'vitest'

import { enqueueStartDownloadTask } from '@/entrypoints/background/download-queue'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
import type { CentralizedStateManager } from '@/src/runtime/centralized-state'

describe('enqueueStartDownloadTask', () => {
  it('creates queued task from START_DOWNLOAD payload with preserved raw and integration-provided chapter metadata', async () => {
    const addDownloadTask = vi.fn(async (_task: unknown) => {})
    const stateManager = {
      getGlobalState: vi.fn(async () => ({
        downloadQueue: [],
        settings: DEFAULT_SETTINGS,
        lastActivity: Date.now(),
      })),
      addDownloadTask,
    } as unknown as CentralizedStateManager

    const result = await enqueueStartDownloadTask(
      stateManager,
      {
        siteIntegrationId: 'mangadex',
        mangaId: 'series-1',
        seriesTitle: ' Series Title ',
        chapters: [
          {
            id: 'chapter-1',
            title: ' Chapter 12 ',
            url: 'https://mangadex.org/chapter/1',
            index: 1,
            chapterLabel: 'Ch. 12.5',
            chapterNumber: 12.5,
            volumeLabel: 'Vol. 02',
            volumeNumber: 2,
            language: 'en',
          },
        ],
        metadata: {
          author: 'Author Name',
          coverUrl: 'https://example.com/cover.jpg',
          publisher: 'Test Publisher',
          readingDirection: 'rtl',
        },
      },
      99,
    )

    expect(result.success).toBe(true)
    expect(typeof result.taskId).toBe('string')
    expect(result.taskId?.length ?? 0).toBeGreaterThan(0)

    const firstCall = addDownloadTask.mock.calls[0]
    expect(firstCall).toBeTruthy()

    const task = firstCall?.[0] as unknown as {
      siteIntegrationId: string
      mangaId: string
      seriesTitle: string
      seriesCoverUrl?: string
      chapters: Array<{ chapterLabel?: string; chapterNumber?: number; volumeNumber?: number; volumeLabel?: string; status: string }>
      settingsSnapshot: {
        archiveFormat: string
        siteIntegrationId: string
        comicInfo?: {
          publisher?: string
          readingDirection?: string
          coverUrl?: string
        }
      }
    }

    expect(task.siteIntegrationId).toBe('mangadex')
    expect(task.mangaId).toBe('series-1')
    expect(task.seriesTitle).toBe('Series Title')
    expect(task.seriesCoverUrl).toBe('https://example.com/cover.jpg')
    expect(task.settingsSnapshot.comicInfo?.publisher).toBe('Test Publisher')
    expect(task.settingsSnapshot.comicInfo?.readingDirection).toBe('rtl')
    expect(task.chapters[0]).toEqual(
      expect.objectContaining({
        status: 'queued',
        chapterLabel: 'Ch. 12.5',
        chapterNumber: 12.5,
        volumeNumber: 2,
        volumeLabel: 'Vol. 02',
        language: 'en',
      }),
    )
    expect(task.settingsSnapshot).toEqual(
      expect.objectContaining({ archiveFormat: 'cbz', siteIntegrationId: 'mangadex' }),
    )
  })

  it('does not parse chapter or volume numbers in SW when integrations omit them', async () => {
    const addDownloadTask = vi.fn(async (_task: unknown) => {})
    const stateManager = {
      getGlobalState: vi.fn(async () => ({
        downloadQueue: [],
        settings: DEFAULT_SETTINGS,
        lastActivity: Date.now(),
      })),
      addDownloadTask,
    } as unknown as CentralizedStateManager

    await enqueueStartDownloadTask(
      stateManager,
      {
        siteIntegrationId: 'pixiv-comic',
        mangaId: 'series-2',
        seriesTitle: 'Series Title',
        chapters: [
          {
            id: 'chapter-2',
            title: 'Volume 01 Episode 07',
            url: 'https://comic.pixiv.net/viewer/stories/2',
            index: 2,
            chapterLabel: 'Ch. 7',
            volumeLabel: 'Vol. 01',
            language: 'ja',
          },
        ],
      },
      100,
    )

    const task = addDownloadTask.mock.calls[0]?.[0] as {
      chapters: Array<{ chapterLabel?: string; chapterNumber?: number; volumeNumber?: number; volumeLabel?: string }>
    }

    expect(task.chapters[0]).toEqual(
      expect.objectContaining({
        chapterLabel: 'Ch. 7',
        chapterNumber: undefined,
        volumeLabel: 'Vol. 01',
        volumeNumber: undefined,
      }),
    )
  })

  it('rejects empty chapter list', async () => {
    const stateManager = {
      getGlobalState: vi.fn(async () => ({
        downloadQueue: [],
        settings: DEFAULT_SETTINGS,
        lastActivity: Date.now(),
      })),
      addDownloadTask: vi.fn(async () => {}),
    } as unknown as CentralizedStateManager

    const result = await enqueueStartDownloadTask(
      stateManager,
      {
        siteIntegrationId: 'mangadex',
        mangaId: 'series-1',
        seriesTitle: 'Series',
        chapters: [],
      },
      1,
    )

    expect(result).toEqual({ success: false, reason: 'No chapters selected for download' })
  })

  it('rejects chapters without stable ids', async () => {
    const addDownloadTask = vi.fn(async (_task: unknown) => {})
    const stateManager = {
      getGlobalState: vi.fn(async () => ({
        downloadQueue: [],
        settings: DEFAULT_SETTINGS,
        lastActivity: Date.now(),
      })),
      addDownloadTask,
    } as unknown as CentralizedStateManager

    const result = await enqueueStartDownloadTask(
      stateManager,
      {
        siteIntegrationId: 'mangadex',
        mangaId: 'series-1',
        seriesTitle: 'Series',
        chapters: [
          {
            id: '',
            title: 'Chapter 1',
            url: 'https://mangadex.org/chapter/1',
            index: 1,
          },
        ],
      },
      1,
    )

    expect(result).toEqual({ success: false, reason: 'Invalid START_DOWNLOAD payload' })
    expect(addDownloadTask).not.toHaveBeenCalled()
  })
})


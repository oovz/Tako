import { describe, expect, it } from 'vitest'

import {
  ActionMessageSchema,
  FetchSeriesDataResponseSchema,
  GetTabIdResponseSchema,
  OffscreenMessageSchema,
  RuntimeMessageSchema,
} from '@/src/runtime/message-schemas'
import { StateAction } from '@/src/types/state-actions'

describe('message-schemas', () => {
  it('accepts GET_TAB_ID and GET_SETTINGS runtime command messages', () => {
    expect(ActionMessageSchema.parse({ type: 'GET_TAB_ID' }).type).toBe('GET_TAB_ID')
    expect(ActionMessageSchema.parse({ type: 'GET_SETTINGS' }).type).toBe('GET_SETTINGS')
  })

  it('accepts SYNC_SETTINGS_TO_STATE with a settings payload', () => {
    const parsed = ActionMessageSchema.parse({
      type: 'SYNC_SETTINGS_TO_STATE',
      payload: {
        settings: {
          downloads: { defaultFormat: 'zip' },
        },
      },
    })

    expect(parsed.type).toBe('SYNC_SETTINGS_TO_STATE')
    if (parsed.type !== 'SYNC_SETTINGS_TO_STATE') {
      throw new Error('Expected SYNC_SETTINGS_TO_STATE message')
    }
    expect(parsed.payload.settings).toEqual({
      downloads: { defaultFormat: 'zip' },
    })
  })

  it('accepts STATE_ACTION runtime messages', () => {
    const parsed = ActionMessageSchema.parse({
      type: 'STATE_ACTION',
      action: StateAction.CLEAR_TAB_STATE,
      tabId: 42,
      payload: { reason: 'navigation' },
      timestamp: 1234567890,
    })

    expect(parsed.type).toBe('STATE_ACTION')
    if (parsed.type !== 'STATE_ACTION') {
      throw new Error('Expected STATE_ACTION message')
    }
    expect(parsed.action).toBe(StateAction.CLEAR_TAB_STATE)
    expect(parsed.tabId).toBe(42)
  })

  it('accepts START_DOWNLOAD with fat payload contract', () => {
    const parsed = ActionMessageSchema.parse({
      type: 'START_DOWNLOAD',
      payload: {
        siteIntegrationId: 'mangadex',
        mangaId: 'series-123',
        seriesTitle: 'A Title',
        chapters: [
          {
            id: 'ch-1',
            title: 'Chapter 1',
            url: 'https://example.com/ch/1',
            index: 1,
            chapterLabel: '1',
            volumeId: 'volume-1',
            volumeLabel: 'Vol. 1',
            language: 'en',
          },
        ],
        metadata: {
          author: 'Author Name',
          publisher: 'Test Publisher',
          readingDirection: 'rtl',
        },
      },
    })

    expect(parsed.type).toBe('START_DOWNLOAD')
    if (parsed.type !== 'START_DOWNLOAD') {
      throw new Error('Expected START_DOWNLOAD message')
    }
    expect(parsed.payload.chapters[0].chapterLabel).toBe('1')
    expect(parsed.payload.chapters[0].volumeId).toBe('volume-1')
    expect(parsed.payload.metadata).toEqual({
      author: 'Author Name',
      publisher: 'Test Publisher',
      readingDirection: 'rtl',
    })
  })

  it('accepts START_DOWNLOAD with optional sourceTabId from extension page senders', () => {
    const parsed = ActionMessageSchema.parse({
      type: 'START_DOWNLOAD',
      payload: {
        sourceTabId: 42,
        siteIntegrationId: 'mangadex',
        mangaId: 'series-123',
        seriesTitle: 'A Title',
        chapters: [
          {
            id: 'ch-1',
            title: 'Chapter 1',
            url: 'https://example.com/ch/1',
            index: 1,
          },
        ],
      },
    })

    if (parsed.type !== 'START_DOWNLOAD') {
      throw new Error('Expected START_DOWNLOAD message')
    }

    expect(parsed.payload.sourceTabId).toBe(42)
  })

  it('accepts START_DOWNLOAD with sourceTabId zero', () => {
    const parsed = ActionMessageSchema.parse({
      type: 'START_DOWNLOAD',
      payload: {
        sourceTabId: 0,
        siteIntegrationId: 'mangadex',
        mangaId: 'series-123',
        seriesTitle: 'A Title',
        chapters: [
          {
            id: 'chapter-1',
            title: 'Chapter 1',
            url: 'https://mangadex.org/chapter/1',
            index: 1,
          },
        ],
      },
    })

    if (parsed.type !== 'START_DOWNLOAD') {
      throw new Error('Expected START_DOWNLOAD message')
    }

    expect(parsed.payload.sourceTabId).toBe(0)
  })

  it('accepts optional integration-provided numeric chapter fields in START_DOWNLOAD payloads', () => {
    const parsed = ActionMessageSchema.parse({
      type: 'START_DOWNLOAD',
      payload: {
        siteIntegrationId: 'mangadex',
        mangaId: 'series-123',
        seriesTitle: 'A Title',
        chapters: [
          {
            id: 'ch-1',
            title: 'Chapter 1',
            url: 'https://example.com/ch/1',
            index: 1,
            chapterLabel: '1',
            chapterNumber: 1,
            volumeLabel: 'Vol. 1',
            volumeNumber: 1,
          },
        ],
      },
    })

    if (parsed.type !== 'START_DOWNLOAD') {
      throw new Error('Expected START_DOWNLOAD message')
    }

    expect(parsed.payload.chapters[0]).toEqual(
      expect.objectContaining({
        chapterLabel: '1',
        chapterNumber: 1,
        volumeLabel: 'Vol. 1',
        volumeNumber: 1,
      }),
    )
  })

  it('rejects START_DOWNLOAD with empty chapter list', () => {
    expect(() =>
      ActionMessageSchema.parse({
        type: 'START_DOWNLOAD',
        payload: {
          siteIntegrationId: 'mangadex',
          mangaId: 'series-123',
          seriesTitle: 'A Title',
          chapters: [],
        },
      }),
    ).toThrowError()
  })

  it('accepts OFFSCREEN_DOWNLOAD_PROGRESS contract shape', () => {
    const parsed = OffscreenMessageSchema.parse({
      type: 'OFFSCREEN_DOWNLOAD_PROGRESS',
      payload: {
        taskId: 'task-1',
        chapterId: 'chapter-1',
        status: 'downloading',
        chapterTitle: 'Chapter 1',
        imagesProcessed: 0,
        imagesFailed: 0,
        totalImages: 10,
      },
    })

    expect(parsed.type).toBe('OFFSCREEN_DOWNLOAD_PROGRESS')
    if (parsed.type !== 'OFFSCREEN_DOWNLOAD_PROGRESS') {
      throw new Error('Expected OFFSCREEN_DOWNLOAD_PROGRESS message')
    }
    expect(parsed.payload.status).toBe('downloading')
    expect(parsed.payload.chapterTitle).toBe('Chapter 1')
  })

  it('accepts OFFSCREEN_STATUS and OFFSCREEN_CONTROL contract shapes', () => {
    expect(OffscreenMessageSchema.parse({ type: 'OFFSCREEN_STATUS' }).type).toBe('OFFSCREEN_STATUS')

    const parsed = OffscreenMessageSchema.parse({
      type: 'OFFSCREEN_CONTROL',
      payload: {
        taskId: 'task-1',
        action: 'cancel',
      },
    })

    expect(parsed.type).toBe('OFFSCREEN_CONTROL')
    if (parsed.type !== 'OFFSCREEN_CONTROL') {
      throw new Error('Expected OFFSCREEN_CONTROL message')
    }
    expect(parsed.payload.action).toBe('cancel')
  })

  it('accepts OFFSCREEN_DOWNLOAD_CHAPTER with series metadata payload', () => {
    const parsed = OffscreenMessageSchema.parse({
      type: 'OFFSCREEN_DOWNLOAD_CHAPTER',
      payload: {
        taskId: 'task-1',
        seriesKey: 'mangadex:series-1',
        book: {
          siteIntegrationId: 'mangadex',
          seriesTitle: 'A Title',
          coverUrl: 'https://example.com/cover.png',
          metadata: {
            author: 'Author Name',
            publisher: 'Test Publisher',
            readingDirection: 'rtl',
          },
        },
        chapter: {
          id: 'ch-1',
          title: 'Chapter 1',
          url: 'https://example.com/ch/1',
          index: 1,
          resolvedPath: 'Series/Chapter 1.cbz',
        },
        settingsSnapshot: {
          archiveFormat: 'cbz',
        },
        saveMode: 'downloads-api',
      },
    })

    expect(parsed.type).toBe('OFFSCREEN_DOWNLOAD_CHAPTER')
    if (parsed.type !== 'OFFSCREEN_DOWNLOAD_CHAPTER') {
      throw new Error('Expected OFFSCREEN_DOWNLOAD_CHAPTER message')
    }

    expect(parsed.payload.book.metadata).toEqual({
      author: 'Author Name',
      publisher: 'Test Publisher',
      readingDirection: 'rtl',
    })
  })

  it('rejects legacy task-level fields on OFFSCREEN_DOWNLOAD_PROGRESS payloads', () => {
    const parsed = OffscreenMessageSchema.safeParse({
      type: 'OFFSCREEN_DOWNLOAD_PROGRESS',
      payload: {
        taskId: 'task-1',
        chapterId: 'chapter-1',
        status: 'partial_success',
        chapterTitle: 'Chapter 1',
        progress: 87,
        currentChapter: 'Chapter 1',
        etaSeconds: 12,
        completed: 1_700_000_000_000,
        errorMessage: '1/10 images failed',
        downloadFormat: 'cbz',
        imagesProcessed: 9,
        imagesFailed: 1,
        totalImages: 10,
        currentImageIndex: 9,
        totalImagesInChapter: 10,
        downloadId: 123,
        chapterOutcomes: [
          {
            chapterUrl: 'https://example.com/chapter/1',
            status: 'partial_success',
            errorMessage: '1/10 images failed',
            imagesFailed: 1,
          },
        ],
        fsaFallbackTriggered: false,
      },
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects removed CANCEL_DOWNLOAD runtime messages', () => {
    const parsed = RuntimeMessageSchema.safeParse({
      type: 'CANCEL_DOWNLOAD',
      payload: { taskId: 'task-1' },
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects removed REMOVE_TASK runtime messages', () => {
    const parsed = RuntimeMessageSchema.safeParse({
      type: 'REMOVE_TASK',
      payload: { taskId: 'task-1' },
    })

    expect(parsed.success).toBe(false)
  })

  it('accepts OPEN_OPTIONS with valid tab', () => {
    const parsed = ActionMessageSchema.parse({
      type: 'OPEN_OPTIONS',
      payload: { page: 'downloads' },
    })

    if (parsed.type !== 'OPEN_OPTIONS') {
      throw new Error('Expected OPEN_OPTIONS message')
    }
    expect(parsed.payload.page).toBe('downloads')
  })

  it('rejects OPEN_OPTIONS with unknown tab', () => {
    expect(() =>
      ActionMessageSchema.parse({
        type: 'OPEN_OPTIONS',
        payload: { page: 'unknown' },
      }),
    ).toThrowError()
  })

  it('accepts the union of action and offscreen messages', () => {
    expect(
      RuntimeMessageSchema.safeParse({
        type: 'STATE_ACTION',
        action: StateAction.CLEAR_TAB_STATE,
        tabId: 42,
      }).success,
    ).toBe(true)

    expect(
      RuntimeMessageSchema.safeParse({
        type: 'OFFSCREEN_DOWNLOAD_API_REQUEST',
        payload: {
          taskId: 'task-1',
          chapterId: 'chapter-1',
          fileUrl: 'blob:chrome-extension://abc',
          filename: 'Series/Chapter 1.cbz',
        },
      }).success,
    ).toBe(true)

    expect(
      RuntimeMessageSchema.safeParse({
        type: 'OFFSCREEN_STATUS',
      }).success,
    ).toBe(true)
  })

  it('rejects stale DATA_REQUEST runtime messages', () => {
    const parsed = RuntimeMessageSchema.safeParse({
      type: 'DATA_REQUEST',
      payload: {
        type: 'manga-state',
        tabId: 42,
      },
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects stale PING runtime messages', () => {
    const parsed = RuntimeMessageSchema.safeParse({
      type: 'PING',
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects removed SET_SESSION_FORMAT runtime messages', () => {
    const parsed = RuntimeMessageSchema.safeParse({
      type: 'SET_SESSION_FORMAT',
      payload: {
        format: 'cbz',
      },
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects removed SHOW_NOTIFICATION runtime messages', () => {
    const parsed = RuntimeMessageSchema.safeParse({
      type: 'SHOW_NOTIFICATION',
      payload: {
        title: 'Notice',
        message: 'Legacy relay should be removed',
        type: 'warning',
      },
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects removed CHAPTER_COMPLETE_NOTIFICATION runtime messages', () => {
    const parsed = RuntimeMessageSchema.safeParse({
      type: 'CHAPTER_COMPLETE_NOTIFICATION',
      payload: {
        seriesTitle: 'Series',
        chapterTitle: 'Chapter 1',
        chapterNumber: 1,
        totalChapters: 10,
      },
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects removed OFFSCREEN_REQUEST_DOWNLOAD runtime messages', () => {
    const parsed = RuntimeMessageSchema.safeParse({
      type: 'OFFSCREEN_REQUEST_DOWNLOAD',
      payload: {
        dataUrl: 'data:application/zip;base64,AAA=',
        filename: 'Library/Series/Chapter 1.zip',
        conflictAction: 'uniquify',
      },
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects stale REINIT_MANGA_STATE runtime messages', () => {
    const parsed = RuntimeMessageSchema.safeParse({
      type: 'REINIT_MANGA_STATE',
      url: 'https://example.com/series/1',
    })

    expect(parsed.success).toBe(false)
  })
})

describe('GetTabIdResponseSchema', () => {
  it('accepts a successful response with a nonnegative integer tabId', () => {
    const parsed = GetTabIdResponseSchema.safeParse({ success: true, tabId: 42 })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.success).toBe(true)
      if (parsed.data.success) {
        expect(parsed.data.tabId).toBe(42)
      }
    }
  })

  it('accepts tabId zero', () => {
    const parsed = GetTabIdResponseSchema.safeParse({ success: true, tabId: 0 })
    expect(parsed.success).toBe(true)
  })

  it('accepts an error response', () => {
    const parsed = GetTabIdResponseSchema.safeParse({ success: false, error: 'no tab' })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.success).toBe(false)
    }
  })

  it('rejects a negative tabId', () => {
    expect(GetTabIdResponseSchema.safeParse({ success: true, tabId: -1 }).success).toBe(false)
  })

  it('rejects a non-integer tabId', () => {
    expect(GetTabIdResponseSchema.safeParse({ success: true, tabId: 1.5 }).success).toBe(false)
  })

  it('rejects success:true without tabId', () => {
    expect(GetTabIdResponseSchema.safeParse({ success: true }).success).toBe(false)
  })

  it('rejects a non-boolean success field', () => {
    expect(GetTabIdResponseSchema.safeParse({ success: 'true', tabId: 5 }).success).toBe(false)
  })

  it('rejects null', () => {
    expect(GetTabIdResponseSchema.safeParse(null).success).toBe(false)
  })

  it('rejects undefined', () => {
    expect(GetTabIdResponseSchema.safeParse(undefined).success).toBe(false)
  })
})

describe('FetchSeriesDataResponseSchema', () => {
  it('accepts a successful response with seriesMetadata and chapterList', () => {
    const parsed = FetchSeriesDataResponseSchema.safeParse({
      success: true,
      seriesMetadata: { title: 'Series', author: 'Author' },
      chapterList: { chapters: [], volumes: [] },
    })
    expect(parsed.success).toBe(true)
    if (parsed.success && parsed.data.success) {
      expect(parsed.data.seriesMetadata).toEqual({ title: 'Series', author: 'Author' })
    }
  })

  it('accepts a successful response with only metadataError', () => {
    const parsed = FetchSeriesDataResponseSchema.safeParse({
      success: true,
      metadataError: 'Chapter list unavailable',
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts an error response', () => {
    const parsed = FetchSeriesDataResponseSchema.safeParse({
      success: false,
      error: 'Network failure',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.success).toBe(false)
    }
  })

  it('accepts a response with unknown-typed seriesMetadata (W3: z.unknown not z.any)', () => {
    const parsed = FetchSeriesDataResponseSchema.safeParse({
      success: true,
      seriesMetadata: 'not-an-object',
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects a response missing the success field', () => {
    expect(
      FetchSeriesDataResponseSchema.safeParse({ seriesMetadata: { title: 'X' } }).success,
    ).toBe(false)
  })

  it('rejects a response with a non-string error', () => {
    expect(
      FetchSeriesDataResponseSchema.safeParse({ success: false, error: 42 }).success,
    ).toBe(false)
  })

  it('rejects null', () => {
    expect(FetchSeriesDataResponseSchema.safeParse(null).success).toBe(false)
  })
})


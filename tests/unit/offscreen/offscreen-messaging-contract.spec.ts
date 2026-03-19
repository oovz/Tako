import { describe, expect, it } from 'vitest'

import { OffscreenMessageSchema, RuntimeMessageSchema } from '@/src/runtime/message-schemas'

describe('offscreen messaging contracts (behavior-based)', () => {
  it('accepts OFFSCREEN_DOWNLOAD_PROGRESS payloads with chapter-scoped progress fields', () => {
    const parsed = OffscreenMessageSchema.parse({
      type: 'OFFSCREEN_DOWNLOAD_PROGRESS',
      payload: {
        taskId: 'task-1',
        chapterId: 'chapter-1',
        chapterTitle: 'Chapter 1',
        status: 'downloading',
        imagesProcessed: 5,
        totalImages: 20,
        fsaFallbackTriggered: true,
      },
    })

    expect(parsed.type).toBe('OFFSCREEN_DOWNLOAD_PROGRESS')
  })

  it('accepts OFFSCREEN_DOWNLOAD_API_REQUEST payload shape for browser downloads', () => {
    const parsed = RuntimeMessageSchema.parse({
      type: 'OFFSCREEN_DOWNLOAD_API_REQUEST',
      payload: {
        taskId: 'task-1',
        chapterId: 'chapter-1',
        fileUrl: 'blob:test-url',
        filename: 'Series/Chapter 1.cbz',
      },
    })

    expect(parsed.type).toBe('OFFSCREEN_DOWNLOAD_API_REQUEST')
  })

  it('rejects non-canonical waiting status in OFFSCREEN_DOWNLOAD_PROGRESS payloads', () => {
    const parsed = OffscreenMessageSchema.safeParse({
      type: 'OFFSCREEN_DOWNLOAD_PROGRESS',
      payload: {
        taskId: 'task-1',
        chapterId: 'chapter-1',
        status: 'waiting',
      },
    })

    expect(parsed.success).toBe(false)
  })

  it('does not accept legacy OFFSCREEN_ARCHIVE_DOWNLOADED in runtime message schema', () => {
    const parsed = RuntimeMessageSchema.safeParse({
      type: 'OFFSCREEN_ARCHIVE_DOWNLOADED',
      payload: {
        taskId: 'task-1',
        jobId: 'job-1',
      },
    })

    expect(parsed.success).toBe(false)
  })
})


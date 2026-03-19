import { z } from 'zod'

const ChapterPayloadSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  index: z.number().int().positive(),
  chapterLabel: z.string().min(1).optional(),
  chapterNumber: z.number().optional(),
  volumeLabel: z.string().min(1).optional(),
  volumeNumber: z.number().optional(),
  language: z.string().min(1).optional(),
})

const StartDownloadPayloadSchema = z.object({
  sourceTabId: z.number().int().nonnegative().optional(),
  siteIntegrationId: z.string().min(1),
  mangaId: z.string().min(1),
  seriesTitle: z.string().min(1),
  chapters: z.array(ChapterPayloadSchema).min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const ActionMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('INITIALIZE_TAB'),
    payload: z.union([
      z.object({
        siteIntegrationId: z.string().min(1),
        url: z.string().url(),
        mangaId: z.string().min(1),
        seriesTitle: z.string().optional(),
        chapters: z.array(ChapterPayloadSchema).optional(),
        volumes: z.array(z.object({ id: z.string().min(1), title: z.string().optional(), label: z.string().optional() })).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      z.object({ error: z.string().min(1) }),
      z.object({ unsupportedPage: z.literal(true) }),
    ]),
  }),
  z.object({
    type: z.literal('START_DOWNLOAD'),
    payload: StartDownloadPayloadSchema,
  }),
  z.object({
    type: z.literal('CANCEL_DOWNLOAD'),
    payload: z.object({ taskId: z.string().min(1) }),
  }),
  z.object({
    type: z.literal('RETRY_FAILED_CHAPTERS'),
    payload: z.object({ taskId: z.string().min(1) }),
  }),
  z.object({
    type: z.literal('RESTART_TASK'),
    payload: z.object({ taskId: z.string().min(1) }),
  }),
  z.object({
    type: z.literal('REMOVE_TASK'),
    payload: z.object({ taskId: z.string().min(1) }),
  }),
  z.object({
    type: z.literal('MOVE_TASK_TO_TOP'),
    payload: z.object({ taskId: z.string().min(1) }),
  }),
  z.object({
    type: z.literal('CLEAR_ALL_HISTORY'),
    payload: z.object({}).default({}),
  }),
  z.object({
    type: z.literal('ACKNOWLEDGE_ERROR'),
    payload: z.object({ code: z.string().min(1) }),
  }),
  z.object({
    type: z.literal('OPEN_OPTIONS'),
    payload: z.object({ page: z.enum(['global', 'integrations', 'downloads', 'debug']).optional() }).default({}),
  }),
])

export const OffscreenMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('REVOKE_BLOB_URL'),
    payload: z.object({ blobUrl: z.string().min(1) }),
  }),
  z.object({
    type: z.literal('OFFSCREEN_DOWNLOAD_CHAPTER'),
    payload: z.object({
      taskId: z.string().min(1),
      seriesKey: z.string().min(1),
      book: z.object({
        siteIntegrationId: z.string().min(1),
        seriesTitle: z.string().min(1),
        coverUrl: z.string().url().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      chapter: z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        url: z.string().url(),
        index: z.number().int().positive(),
        chapterLabel: z.string().optional(),
        chapterNumber: z.number().optional(),
        volumeNumber: z.number().optional(),
        volumeLabel: z.string().optional(),
        language: z.string().optional(),
        resolvedPath: z.string().min(1),
      }),
      settingsSnapshot: z.record(z.string(), z.unknown()),
      saveMode: z.enum(['fsa', 'downloads-api']),
      integrationContext: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
  z.object({
    type: z.literal('OFFSCREEN_DOWNLOAD_API_REQUEST'),
    payload: z.object({
      taskId: z.string().min(1),
      chapterId: z.string().min(1),
      fileUrl: z.string().min(1),
      filename: z.string().min(1),
    }),
  }),
  z.object({
    type: z.literal('OFFSCREEN_DOWNLOAD_PROGRESS'),
    payload: z.object({
      taskId: z.string().min(1),
      chapterId: z.string().min(1),
      status: z.enum(['downloading', 'completed', 'failed', 'partial_success']),
      chapterTitle: z.string().min(1).optional(),
      imagesProcessed: z.number().int().min(0).optional(),
      imagesFailed: z.number().int().min(0).optional(),
      totalImages: z.number().int().min(0).optional(),
      error: z.string().optional(),
      errorCategory: z.enum(['network', 'download', 'other']).optional(),
      fsaFallbackTriggered: z.boolean().optional(),
    }).strict(),
  }),
])

export const RuntimeMessageSchema = z.union([ActionMessageSchema, OffscreenMessageSchema])

export type ActionMessage = z.infer<typeof ActionMessageSchema>
export type OffscreenMessage = z.infer<typeof OffscreenMessageSchema>
export type RuntimeMessage = z.infer<typeof RuntimeMessageSchema>

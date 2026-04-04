import { z } from 'zod'
import { DownloadErrorCategorySchema, DownloadTaskStatusSchema } from '@/src/shared/download-contract'
import { StateAction } from '@/src/types/state-actions'

const InitializeTabChapterSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  title: z.string().min(1),
  locked: z.boolean().optional(),
  chapterLabel: z.string().min(1).optional(),
  chapterNumber: z.number().optional(),
  volumeNumber: z.number().optional(),
  volumeLabel: z.string().min(1).optional(),
  language: z.string().min(1).optional(),
})

const InitializeTabVolumeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
})

export const InitializeTabPayloadSchema = z.discriminatedUnion('context', [
  z.object({
    context: z.literal('ready'),
    siteIntegrationId: z.string().min(1),
    mangaId: z.string().min(1),
    seriesTitle: z.string().min(1),
    chapters: z.array(InitializeTabChapterSchema).optional().default([]),
    volumes: z.array(InitializeTabVolumeSchema).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    context: z.literal('unsupported'),
  }),
  z.object({
    context: z.literal('error'),
    error: z.string().min(1),
  }),
])

export const UpdateDownloadTaskPayloadSchema = z.object({
  taskId: z.string().min(1),
  updates: z.object({
    status: DownloadTaskStatusSchema.optional(),
    errorMessage: z.string().optional(),
    errorCategory: DownloadErrorCategorySchema.optional(),
    started: z.number().optional(),
    completed: z.number().optional(),
    isRetried: z.boolean().optional(),
    isRetryTask: z.boolean().optional(),
    lastSuccessfulDownloadId: z.number().optional(),
  }),
})

export const TaskIdPayloadSchema = z.object({
  taskId: z.string().min(1),
})

export const UpdateSettingsPayloadSchema = z.object({
  settings: z.record(z.string(), z.unknown()),
})

export const ClearDownloadHistoryPayloadSchema = z.object({
  seriesId: z.string().min(1).optional(),
}).default({})

const StateActionPayloadSchemas = {
  [StateAction.INITIALIZE_TAB]: InitializeTabPayloadSchema,
  [StateAction.CLEAR_TAB_STATE]: z.undefined(),
  [StateAction.UPDATE_DOWNLOAD_TASK]: UpdateDownloadTaskPayloadSchema,
  [StateAction.REMOVE_DOWNLOAD_TASK]: TaskIdPayloadSchema,
  [StateAction.CANCEL_DOWNLOAD_TASK]: TaskIdPayloadSchema,
  [StateAction.UPDATE_SETTINGS]: UpdateSettingsPayloadSchema,
  [StateAction.CLEAR_DOWNLOAD_HISTORY]: ClearDownloadHistoryPayloadSchema,
} as const

export function parseStateActionPayload(action: StateAction, payload: unknown): unknown {
  return StateActionPayloadSchemas[action].parse(payload)
}

import { z } from 'zod'
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

export const TaskIdPayloadSchema = z.object({
  taskId: z.string().min(1),
})

const StateActionPayloadSchemas = {
  [StateAction.INITIALIZE_TAB]: InitializeTabPayloadSchema,
  [StateAction.CLEAR_TAB_STATE]: z.undefined(),
  [StateAction.REMOVE_DOWNLOAD_TASK]: TaskIdPayloadSchema,
  [StateAction.CANCEL_DOWNLOAD_TASK]: TaskIdPayloadSchema,
} as const

export function parseStateActionPayload(action: StateAction, payload: unknown): unknown {
  return StateActionPayloadSchemas[action].parse(payload)
}

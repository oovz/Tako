import { z } from "zod"

import { DownloadTaskChapterStatusSchema } from "@/src/shared/download-contract"
import { SeriesMetadataSnapshotSchema } from "@/src/runtime/series-data-schemas"
import type {
  ActiveTabContextByWindow,
  ChapterState,
  MangaPageState,
  ProjectedTabContext,
  VolumeState,
  WindowTabContext,
} from "@/src/types/tab-state"

const NonEmptyStringSchema = z.string().min(1)
const NonNegativeIntegerSchema = z.number().int().nonnegative()

export const ChapterStateSchema = z.strictObject({
  id: NonEmptyStringSchema,
  url: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  locked: z.boolean().optional(),
  index: NonNegativeIntegerSchema,
  language: NonEmptyStringSchema.optional(),
  chapterLabel: NonEmptyStringSchema.optional(),
  chapterNumber: z.number().finite().optional(),
  volumeId: NonEmptyStringSchema.optional(),
  volumeNumber: z.number().finite().optional(),
  volumeLabel: NonEmptyStringSchema.optional(),
  status: DownloadTaskChapterStatusSchema,
  errorMessage: NonEmptyStringSchema.optional(),
  totalImages: NonNegativeIntegerSchema.optional(),
  imagesFailed: NonNegativeIntegerSchema.optional(),
  lastUpdated: NonNegativeIntegerSchema,
}) satisfies z.ZodType<ChapterState>

export const VolumeStateSchema = z.strictObject({
  id: NonEmptyStringSchema,
  title: NonEmptyStringSchema.optional(),
  label: NonEmptyStringSchema.optional(),
}) satisfies z.ZodType<VolumeState>

const UniqueChapterStatesSchema = z
  .array(ChapterStateSchema)
  .superRefine((chapters, context) => {
    const chapterIds = new Set<string>()
    for (const [index, chapter] of chapters.entries()) {
      if (chapterIds.has(chapter.id)) {
        context.addIssue({
          code: "custom",
          message: "Chapter IDs must be unique",
          path: [index, "id"],
        })
      }
      chapterIds.add(chapter.id)
    }
  })

export const MangaPageStateSchema = z.strictObject({
  sourceUrl: NonEmptyStringSchema,
  siteIntegrationId: NonEmptyStringSchema,
  mangaId: NonEmptyStringSchema,
  seriesTitle: NonEmptyStringSchema,
  chapters: UniqueChapterStatesSchema,
  volumes: z.array(VolumeStateSchema),
  metadata: SeriesMetadataSnapshotSchema.optional(),
  chaptersLoading: z.boolean().optional(),
  chapterListNotice: z.literal("adult-consent-required").optional(),
  lastUpdated: NonNegativeIntegerSchema,
}) satisfies z.ZodType<MangaPageState>

export const ProjectedTabContextSchema = z.union([
  MangaPageStateSchema,
  z.strictObject({ loading: z.literal(true) }),
  z.strictObject({ error: NonEmptyStringSchema }),
  z.null(),
]) satisfies z.ZodType<ProjectedTabContext>

export const WindowTabContextSchema = z.strictObject({
  windowId: NonNegativeIntegerSchema,
  activeTabId: NonNegativeIntegerSchema,
  context: ProjectedTabContextSchema,
  revision: NonNegativeIntegerSchema,
  timestamp: NonNegativeIntegerSchema,
}) satisfies z.ZodType<WindowTabContext>

export const ActiveTabContextByWindowSchema = z
  .record(z.string(), WindowTabContextSchema)
  .superRefine((contexts, context) => {
    for (const [key, windowContext] of Object.entries(contexts)) {
      const windowId = Number(key)
      if (
        !/^(0|[1-9]\d*)$/.test(key) ||
        !Number.isSafeInteger(windowId) ||
        windowId !== windowContext.windowId
      ) {
        context.addIssue({
          code: "custom",
          message: "Window context key must equal windowId",
          path: [key],
        })
      }
    }
  })

export function parseMangaPageState(
  value: unknown
): MangaPageState | undefined {
  const parsed = MangaPageStateSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export function isMangaPageState(value: unknown): value is MangaPageState {
  return MangaPageStateSchema.safeParse(value).success
}

export function parseActiveTabContextByWindow(
  value: unknown
): ActiveTabContextByWindow | undefined {
  const parsed = ActiveTabContextByWindowSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export function isActiveTabContextByWindow(
  value: unknown
): value is ActiveTabContextByWindow {
  return ActiveTabContextByWindowSchema.safeParse(value).success
}

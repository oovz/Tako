import { z } from "zod"

import { SeriesMetadataSnapshotSchema } from "@/src/runtime/series-data-schemas"

const ResolvedChapterSchema = z.strictObject({
  id: z.string().min(1),
  url: z.string().min(1),
  title: z.string().min(1),
  locked: z.boolean().optional(),
  chapterLabel: z.string().min(1).optional(),
  chapterNumber: z.number().optional(),
  volumeId: z.string().min(1).optional(),
  volumeNumber: z.number().optional(),
  volumeLabel: z.string().min(1).optional(),
  language: z.string().min(1).optional(),
})

const ResolvedVolumeSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
})

const ResolvedChaptersSchema = z
  .array(ResolvedChapterSchema)
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

export const ResolvedTabContextSchema = z.discriminatedUnion("context", [
  z.strictObject({
    context: z.literal("ready"),
    sourceUrl: z.string().min(1),
    siteIntegrationId: z.string().min(1),
    mangaId: z.string().min(1),
    seriesTitle: z.string().min(1),
    chapters: ResolvedChaptersSchema,
    volumes: z.array(ResolvedVolumeSchema).optional(),
    metadata: SeriesMetadataSnapshotSchema.optional(),
    chaptersLoading: z.boolean().optional(),
    chapterListNotice: z.literal("adult-consent-required").optional(),
  }),
  z.strictObject({
    context: z.literal("unsupported"),
  }),
  z.strictObject({
    context: z.literal("error"),
    error: z.string().min(1),
  }),
])

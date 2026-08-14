import { z } from "zod"

const EpisodeJsonPageSchema = z.looseObject({
  type: z.string().optional(),
  src: z.string().optional(),
})

export const EpisodeJsonPayloadSchema = z.looseObject({
  readableProduct: z
    .looseObject({
      isPublic: z.boolean().optional(),
      hasPurchased: z.boolean().optional(),
      series: z
        .looseObject({
          title: z.string().optional(),
          thumbnailUri: z.string().optional(),
          id: z.string().optional(),
        })
        .optional(),
      pageStructure: z
        .looseObject({ pages: z.array(EpisodeJsonPageSchema).optional() })
        .optional(),
    })
    .optional(),
})

export const EpisodeJsonSeriesMetadataSchema = z.strictObject({
  seriesId: z.string().optional(),
  seriesTitle: z.string().optional(),
  seriesThumbnailUri: z.string().optional(),
})

export type EpisodeJsonPayload = z.infer<typeof EpisodeJsonPayloadSchema>
export type EpisodeJsonSeriesMetadata = z.infer<
  typeof EpisodeJsonSeriesMetadataSchema
>

export function parseEpisodeJsonPayload(
  value: unknown
): EpisodeJsonPayload | null {
  const parsed = EpisodeJsonPayloadSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

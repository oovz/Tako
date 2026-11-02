import { z } from "zod"
import { PublicHttpsUrlSchema } from "./series-data-schemas"

export const MAX_COVER_PREVIEW_BYTES = 4 * 1024 * 1024
export const COVER_PREVIEW_TIMEOUT_MS = 15_000

export const CoverPreviewSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("series"),
    tabId: z.number().int().nonnegative(),
    windowId: z.number().int().nonnegative(),
    seriesId: z.string().min(1).max(2048),
    seriesRevision: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("task"),
    taskId: z.string().min(1).max(2048),
  }),
])

export const CoverPreviewResponseSchema = z.union([
  z.strictObject({
    success: z.literal(true),
    integrationId: z.string().min(1),
    coverUrl: PublicHttpsUrlSchema,
    mimeType: z.enum([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "image/avif",
    ]),
    base64: z
      .string()
      .min(4)
      .max(4 * Math.ceil(MAX_COVER_PREVIEW_BYTES / 3))
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  }),
  z.strictObject({ success: z.literal(false), error: z.string().min(1) }),
])

export type CoverPreviewSource = z.infer<typeof CoverPreviewSourceSchema>
export type CoverPreviewResponse = z.infer<typeof CoverPreviewResponseSchema>

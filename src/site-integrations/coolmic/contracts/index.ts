import { z } from "zod"
import { MAX_CHAPTER_IMAGES } from "@/src/constants/timeouts"
const name = z.string().trim().min(1).max(4096)
const episodeStartDate = z
  .string()
  .regex(/^\d{2}\/\d{2}\/\d{2}$/)
  .transform((value) => {
    const [month, day, year] = value.split("/")
    return `20${year}-${month}-${day}`
  })
  .pipe(z.iso.date())
  .optional()
  .catch(undefined)
export const CoolmicTitleBootstrapSchema = z.object({
  unreadable_title_error_code: z.string().max(128).default(""),
  user: z.object({
    is_login: z.boolean(),
    is_monthly_ticket_subscribed: z.boolean().default(false),
  }),
  title: z.object({
    id: z.number().int().positive(),
    name,
    summary: z.string().max(128_000),
    vertical_thumbnail_url: z.string().url(),
    artists: z.array(z.object({ name })).max(100),
    genres: z.array(z.object({ name })).max(100),
    agency: name.optional().catch(undefined),
    contents_image_type: z
      .enum(["page", "vertical"])
      .optional()
      .catch(undefined),
    rating_average: z.number().positive().max(5).optional().catch(undefined),
    rating_records_count: z
      .number()
      .int()
      .positive()
      .optional()
      .catch(undefined),
    is_completed: z.boolean(),
    is_hidden: z.boolean(),
    all_closed: z.boolean(),
  }),
  episodes: z
    .array(
      z.object({
        id: z.number().int().positive(),
        number: name,
        name,
        display_order: z.number().int().nonnegative(),
        start_at: episodeStartDate,
        is_free: z.boolean(),
        was_purchased: z.boolean(),
        is_subscription_free: z.boolean(),
        is_closed: z.boolean(),
        images_count: z.number().int().nonnegative().max(MAX_CHAPTER_IMAGES),
      })
    )
    .min(1)
    .max(10_000),
})
const cookie = z
  .string()
  .min(1)
  .max(8192)
  .regex(/^[a-zA-Z0-9_~+=/.-]+$/)
export const CoolmicViewerSchema = z.object({
  image_data: z
    .array(
      z.object({
        num: z.number().int().nonnegative(),
        path: z.string().url(),
        width: z.coerce.number().int().positive(),
        height: z.coerce.number().int().positive(),
      })
    )
    .min(1)
    .max(MAX_CHAPTER_IMAGES),
  signed_cookie: z.object({
    "CloudFront-Policy": cookie,
    "CloudFront-Signature": cookie,
    "CloudFront-Key-Pair-Id": cookie,
  }),
})
export type CoolmicViewer = z.infer<typeof CoolmicViewerSchema>

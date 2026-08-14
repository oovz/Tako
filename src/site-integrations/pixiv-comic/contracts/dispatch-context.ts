import { z } from "zod"

export const PixivDispatchContextSchema = z.strictObject({
  taskId: z.string().min(1).max(256),
})

export type PixivDispatchContext = z.infer<typeof PixivDispatchContextSchema>

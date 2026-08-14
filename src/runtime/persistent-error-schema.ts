import { z } from "zod"

export const PersistentErrorSeveritySchema = z.enum(["warning", "error"])

export const PersistentErrorSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string(),
  severity: PersistentErrorSeveritySchema,
  ts: z.number().finite().nonnegative(),
})

export const PersistentErrorsSchema = z.array(PersistentErrorSchema)

export type PersistentErrorSeverity = z.infer<
  typeof PersistentErrorSeveritySchema
>
export type PersistentError = z.infer<typeof PersistentErrorSchema>

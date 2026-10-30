import type { z } from "zod"
import { InvalidDurableStateError } from "@/src/runtime/runtime-phase-errors"

/** Validate a present current document and retain its schema failure as cause. */
export function parseDurableState<T>(
  schema: z.ZodType<T>,
  value: unknown,
  description: string
): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new InvalidDurableStateError(`Invalid durable ${description}`, {
      cause: parsed.error,
    })
  }
  return parsed.data
}

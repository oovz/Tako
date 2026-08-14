import {
  PixivDispatchContextSchema,
  type PixivDispatchContext,
} from "./contracts/dispatch-context"

export function preparePixivDispatchContext(
  taskId: string
): PixivDispatchContext {
  return PixivDispatchContextSchema.parse({ taskId })
}

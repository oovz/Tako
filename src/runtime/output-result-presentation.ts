import type { TaskChapter } from "@/src/domain/queue/state"
import { t } from "@/src/runtime/i18n"

export function getCompletedOutputDestination(
  chapters: readonly Pick<TaskChapter, "status" | "outputDestination">[]
): TaskChapter["outputDestination"] {
  const completed = chapters.filter((chapter) => chapter.status === "completed")
  const destination = completed[0]?.outputDestination
  return destination &&
    completed.every((chapter) => chapter.outputDestination === destination)
    ? destination
    : undefined
}

export function getOutputResultLabel(
  destination?: TaskChapter["outputDestination"]
): string {
  if (destination === "downloads-api") return t("status_sentToChrome")
  if (destination === "fsa") return t("status_savedToFolder")
  return t("status_completed")
}

export function hasUncertainNativeOutput(
  chapters: readonly Pick<TaskChapter, "nativeOutputSettlement">[]
): boolean {
  return chapters.some(
    (chapter) => chapter.nativeOutputSettlement?.acceptanceUncertain === true
  )
}

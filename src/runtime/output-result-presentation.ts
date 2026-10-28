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

export function getCompletedSaveConfirmedAt(
  chapters: readonly Pick<TaskChapter, "status" | "saveConfirmedAt">[]
): number | undefined {
  const completed = chapters.filter((chapter) => chapter.status === "completed")
  if (
    completed.length === 0 ||
    completed.some((chapter) => chapter.saveConfirmedAt === undefined)
  )
    return undefined
  return Math.max(...completed.map((chapter) => chapter.saveConfirmedAt!))
}

export function getOutputResultLabel(
  destination?: TaskChapter["outputDestination"],
  saveConfirmedAt?: number
): string {
  if (saveConfirmedAt === undefined) return t("status_processed")
  if (destination === "fsa") return t("status_savedToFolder")
  return t("status_saved")
}

export function hasUncertainNativeOutput(
  chapters: readonly Pick<TaskChapter, "nativeOutputSettlement">[]
): boolean {
  return chapters.some(
    (chapter) => chapter.nativeOutputSettlement?.outputUncertain === true
  )
}

import type { DownloadTaskState } from "./state"
import type { TaskDestination } from "@/src/types/state-snapshots"

export function getEffectiveTaskDestination(
  task: Pick<DownloadTaskState, "settingsSnapshot" | "useChromeFallback">
): TaskDestination {
  return task.useChromeFallback
    ? { kind: "downloads-api" }
    : task.settingsSnapshot.destination
}

export function freshTaskFallbackState(task: DownloadTaskState): {
  useChromeFallback?: true
  fsaFallbackEligible?: true
} {
  return task.useChromeFallback
    ? { useChromeFallback: true }
    : task.settingsSnapshot.allowChromeFallback === true &&
        task.settingsSnapshot.destination.kind === "file-system-access"
      ? { fsaFallbackEligible: true }
      : {}
}

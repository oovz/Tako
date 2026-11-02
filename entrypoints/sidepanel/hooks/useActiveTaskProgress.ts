import { useEffect, useState } from "react"

import {
  normalizeActiveTaskProgress,
  type ActiveTaskProgressSnapshot,
} from "@/src/runtime/active-task-progress"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { useChromeStorageValue } from "@/src/ui/shared/hooks/useChromeStorageValue"
import {
  coherentProgressSnapshot,
  createProgressSnapshotReceiver,
  parseProgressGeneration,
  parseProgressRevision,
  subscribeToActiveTaskProgress,
} from "./useActiveTaskProgressSubscription"

export type ActiveTaskProgress = ActiveTaskProgressSnapshot
export { normalizeActiveTaskProgress }
export { shouldAcceptProgressRevision } from "./useActiveTaskProgressSubscription"

export interface UseActiveTaskProgressResult {
  progress: ActiveTaskProgress | null
  hydrated: boolean
}

function useStoredProgress() {
  const { value: progress, hydrated: progressHydrated } =
    useChromeStorageValue<ActiveTaskProgress | null>({
      areaName: "session",
      key: SESSION_STORAGE_KEYS.activeTaskProgress,
      initialValue: null,
      parse: normalizeActiveTaskProgress,
    })
  const { value: revision, hydrated: revisionHydrated } = useChromeStorageValue<
    number | null
  >({
    areaName: "session",
    key: SESSION_STORAGE_KEYS.activeTaskProgressRevision,
    initialValue: null,
    parse: parseProgressRevision,
  })
  const { value: generation, hydrated: generationHydrated } =
    useChromeStorageValue<string | null>({
      areaName: "session",
      key: SESSION_STORAGE_KEYS.activeTaskProgressGeneration,
      initialValue: null,
      parse: parseProgressGeneration,
    })
  return {
    progress,
    revision,
    generation,
    hydrated: progressHydrated && revisionHydrated && generationHydrated,
  }
}

export function useActiveTaskProgress(): UseActiveTaskProgressResult {
  const stored = useStoredProgress()
  const [progress, setProgress] = useState<ActiveTaskProgress | null>(null)
  const [receiver] = useState(() => createProgressSnapshotReceiver(setProgress))

  useEffect(() => {
    if (!stored.hydrated) return
    receiver.hydrate(
      coherentProgressSnapshot(
        stored.generation,
        stored.revision,
        stored.progress
      )
    )
  }, [
    receiver,
    stored.hydrated,
    stored.generation,
    stored.revision,
    stored.progress,
  ])

  useEffect(() => {
    if (!stored.hydrated) return
    return subscribeToActiveTaskProgress(receiver)
  }, [receiver, stored.hydrated])

  return { progress, hydrated: stored.hydrated }
}

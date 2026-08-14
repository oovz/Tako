import { useEffect, useRef, useState } from "react"

import {
  ACTIVE_TASK_PROGRESS_PORT_NAME,
  normalizeActiveTaskProgress,
  normalizeActiveTaskProgressPortMessage,
  type ActiveTaskProgressSnapshot,
} from "@/src/runtime/active-task-progress"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { useChromeStorageValue } from "@/src/ui/shared/hooks/useChromeStorageValue"

export type ActiveTaskProgress = ActiveTaskProgressSnapshot

function parseProgressRevision(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null
}

function parseProgressGeneration(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

export function shouldAcceptProgressRevision(input: {
  currentGeneration: string | null
  currentRevision: number
  nextGeneration: string
  nextRevision: number
  allowEqual?: boolean
}): boolean {
  if (input.currentGeneration !== input.nextGeneration) return true
  return input.allowEqual
    ? input.nextRevision >= input.currentRevision
    : input.nextRevision > input.currentRevision
}

export { normalizeActiveTaskProgress }

export interface UseActiveTaskProgressResult {
  progress: ActiveTaskProgress | null
  hydrated: boolean
}

export function useActiveTaskProgress(): UseActiveTaskProgressResult {
  const { value: storedProgress, hydrated: progressHydrated } =
    useChromeStorageValue<ActiveTaskProgress | null>({
      areaName: "session",
      key: SESSION_STORAGE_KEYS.activeTaskProgress,
      initialValue: null,
      parse: normalizeActiveTaskProgress,
    })
  const { value: storedRevision, hydrated: revisionHydrated } =
    useChromeStorageValue<number | null>({
      areaName: "session",
      key: SESSION_STORAGE_KEYS.activeTaskProgressRevision,
      initialValue: null,
      parse: parseProgressRevision,
    })
  const { value: storedGeneration, hydrated: generationHydrated } =
    useChromeStorageValue<string | null>({
      areaName: "session",
      key: SESSION_STORAGE_KEYS.activeTaskProgressGeneration,
      initialValue: null,
      parse: parseProgressGeneration,
    })
  const hydrated = progressHydrated && revisionHydrated && generationHydrated
  const [progress, setProgress] = useState<ActiveTaskProgress | null>(null)
  const latestRevisionRef = useRef(0)
  const latestGenerationRef = useRef<string | null>(null)
  const livePortConnectedRef = useRef(false)

  useEffect(() => {
    if (!hydrated) return
    if (livePortConnectedRef.current) return
    if (storedGeneration === null || storedRevision === null) return
    if (
      storedProgress !== null &&
      (storedProgress.generation !== storedGeneration ||
        storedProgress.revision !== storedRevision)
    ) {
      return
    }
    if (
      !shouldAcceptProgressRevision({
        currentGeneration: latestGenerationRef.current,
        currentRevision: latestRevisionRef.current,
        nextGeneration: storedGeneration,
        nextRevision: storedRevision,
        allowEqual: true,
      })
    ) {
      return
    }
    latestGenerationRef.current = storedGeneration
    latestRevisionRef.current = storedRevision
    setProgress(storedProgress)
  }, [hydrated, storedGeneration, storedProgress, storedRevision])

  useEffect(() => {
    if (!hydrated) return
    let disposed = false
    let port: chrome.runtime.Port | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const applySnapshot = (
      generation: string,
      revision: number,
      value: unknown
    ): void => {
      if (
        !shouldAcceptProgressRevision({
          currentGeneration: latestGenerationRef.current,
          currentRevision: latestRevisionRef.current,
          nextGeneration: generation,
          nextRevision: revision,
        })
      ) {
        return
      }
      const normalized = normalizeActiveTaskProgress(value)
      if (value !== null && !normalized) return
      if (
        normalized !== null &&
        (normalized.generation !== generation ||
          normalized.revision !== revision)
      ) {
        return
      }
      latestGenerationRef.current = generation
      latestRevisionRef.current = revision
      setProgress(normalized)
    }

    const rereadSnapshot = async (): Promise<void> => {
      const stored = await chrome.storage.session.get([
        SESSION_STORAGE_KEYS.activeTaskProgress,
        SESSION_STORAGE_KEYS.activeTaskProgressRevision,
        SESSION_STORAGE_KEYS.activeTaskProgressGeneration,
      ])
      const rawProgress = stored[SESSION_STORAGE_KEYS.activeTaskProgress]
      const storedProgressValue = normalizeActiveTaskProgress(rawProgress)
      if (rawProgress !== null && storedProgressValue === null) return
      const storedGenerationValue = parseProgressGeneration(
        stored[SESSION_STORAGE_KEYS.activeTaskProgressGeneration]
      )
      const revision = parseProgressRevision(
        stored[SESSION_STORAGE_KEYS.activeTaskProgressRevision]
      )
      if (storedGenerationValue === null || revision === null) return
      applySnapshot(storedGenerationValue, revision, storedProgressValue)
    }

    const scheduleReconnect = (): void => {
      if (disposed) return
      reconnectTimer = setTimeout(connect, 250)
    }

    const connect = (): void => {
      if (disposed) return
      try {
        const connectedPort = chrome.runtime.connect({
          name: ACTIVE_TASK_PROGRESS_PORT_NAME,
        })
        port = connectedPort
        connectedPort.onMessage.addListener((message: unknown) => {
          if (disposed || port !== connectedPort) return
          const parsed = normalizeActiveTaskProgressPortMessage(message)
          if (!parsed) return
          livePortConnectedRef.current = true
          applySnapshot(parsed.generation, parsed.revision, parsed.progress)
        })
        connectedPort.onDisconnect.addListener(() => {
          if (port !== connectedPort) return
          port = null
          livePortConnectedRef.current = false
          if (disposed) return
          void rereadSnapshot()
            .catch(() => undefined)
            .finally(scheduleReconnect)
        })
      } catch {
        // Session snapshots remain the recovery transport when a Port cannot
        // be opened (for example while the extension is reloading).
        void rereadSnapshot()
          .catch(() => undefined)
          .finally(scheduleReconnect)
      }
    }

    // The storage hooks above hydrate first. Only then do we subscribe to live
    // events, so any event older than the recovery snapshot can be rejected.
    connect()
    return () => {
      disposed = true
      livePortConnectedRef.current = false
      if (reconnectTimer) clearTimeout(reconnectTimer)
      port?.disconnect()
    }
  }, [hydrated])

  return { progress, hydrated }
}

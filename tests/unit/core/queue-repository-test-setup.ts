import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import { vi } from "vitest"

export const mockSessionStorage: Record<string, unknown> = {}
export const mockLocalStorage: Record<string, unknown> = {}

globalThis.chrome = {
  storage: {
    local: {
      get: vi.fn(async (keys?: string | string[] | null) => {
        if (keys === undefined || keys === null) return mockLocalStorage
        const names = typeof keys === "string" ? [keys] : keys
        return Object.fromEntries(
          names
            .filter((key) => key in mockLocalStorage)
            .map((key) => [key, mockLocalStorage[key]])
        )
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(mockLocalStorage, items)
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const key of typeof keys === "string" ? [keys] : keys) {
          delete mockLocalStorage[key]
        }
      }),
    },
    session: {
      get: vi.fn(async (keys?: string | string[] | null) => {
        if (keys === undefined || keys === null) return mockSessionStorage
        const names = typeof keys === "string" ? [keys] : keys
        return Object.fromEntries(
          names
            .filter((key) => key in mockSessionStorage)
            .map((key) => [key, mockSessionStorage[key]])
        )
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(mockSessionStorage, items)
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const key of typeof keys === "string" ? [keys] : keys) {
          delete mockSessionStorage[key]
        }
      }),
      setAccessLevel: vi.fn(async () => undefined),
    },
  },
  tabs: { query: vi.fn(async () => []) },
} as unknown as typeof chrome

export function makeDownloadTask(
  overrides: Partial<DownloadTaskState> = {}
): DownloadTaskState {
  const siteIntegrationId = overrides.siteIntegrationId ?? "mangadex"
  return {
    id: "task-1",
    siteIntegrationId,
    mangaId: "series-1",
    seriesTitle: "Test",
    chapters: [],
    status: "queued",
    created: Date.now(),
    settingsSnapshot: createTaskSettingsSnapshot(
      DEFAULT_SETTINGS,
      siteIntegrationId
    ),
    ...overrides,
  }
}

export function resetQueueRepositoryTestEnvironment(): void {
  Object.keys(mockSessionStorage).forEach(
    (key) => delete mockSessionStorage[key]
  )
  Object.keys(mockLocalStorage).forEach((key) => delete mockLocalStorage[key])
  vi.clearAllMocks()
}

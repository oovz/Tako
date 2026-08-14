import { vi } from "vitest"

import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { QueueRepository } from "@/src/storage/queue-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import type { DownloadTaskState } from "@/src/domain/queue/state"

export function createQueueRepositoryTestHarness(
  queue: DownloadTaskState[]
): QueueRepository {
  const local: Record<string, unknown> = {
    [LOCAL_STORAGE_KEYS.downloadQueue]: structuredClone(queue),
  }

  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const requested = Array.isArray(keys) ? keys : [keys]
          return Object.fromEntries(
            requested.map((key) => [key, structuredClone(local[key])])
          )
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(local, structuredClone(values))
        }),
        remove: vi.fn(async (key: string) => {
          delete local[key]
        }),
      },
      session: {
        set: vi.fn(async () => undefined),
      },
    },
    action: {
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined),
    },
  } as unknown as typeof chrome)

  return new QueueRepository(new QueueProjectionService())
}

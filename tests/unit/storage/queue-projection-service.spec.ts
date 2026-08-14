import { beforeEach, describe, expect, it, vi } from "vitest"

import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { DownloadTaskState } from "@/src/domain/queue/state"

function queuedTask(id: string, seriesTitle: string): DownloadTaskState {
  return {
    id,
    siteIntegrationId: "mangadex",
    mangaId: `series-${id}`,
    seriesTitle,
    chapters: [],
    status: "queued",
    created: 1,
    settingsSnapshot: {},
  } as unknown as DownloadTaskState
}

describe("QueueProjectionService", () => {
  const sessionSet = vi.fn(async () => undefined)
  const setBadgeText = vi.fn(
    async (_details: chrome.action.BadgeTextDetails) => undefined
  )
  const setBadgeBackgroundColor = vi.fn(async () => undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as { chrome: typeof chrome }).chrome = {
      storage: { session: { set: sessionSet } },
      action: { setBadgeText, setBadgeBackgroundColor },
    } as unknown as typeof chrome
  })

  it("clones the queue when publication is submitted", async () => {
    const service = new QueueProjectionService()
    const queue = [queuedTask("task-1", "Original title")]

    const publication = service.publish(queue)
    queue[0].seriesTitle = "Mutated title"
    await publication

    expect(sessionSet).toHaveBeenCalledWith({
      [SESSION_STORAGE_KEYS.queueView]: [
        expect.objectContaining({ seriesTitle: "Original title" }),
      ],
      [SESSION_STORAGE_KEYS.historyView]: [],
    })
  })

  it("publishes FIFO with each session pair before its badge", async () => {
    const events: string[] = []
    let releaseFirst!: () => void
    sessionSet
      .mockImplementationOnce(async () => {
        events.push("session-1")
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
      })
      .mockImplementationOnce(async () => {
        events.push("session-2")
      })
    setBadgeText.mockImplementation(async ({ text }) => {
      events.push(`badge-${text}`)
    })

    const service = new QueueProjectionService()
    const first = service.publish([queuedTask("task-1", "One")])
    const second = service.publish([
      queuedTask("task-1", "One"),
      queuedTask("task-2", "Two"),
    ])

    await vi.waitFor(() => expect(events).toEqual(["session-1"]))
    releaseFirst()
    await Promise.all([first, second])

    expect(events).toEqual(["session-1", "badge-1", "session-2", "badge-2"])
  })

  it("recovers its publication tail after a failed projection write", async () => {
    sessionSet
      .mockRejectedValueOnce(new Error("session unavailable"))
      .mockResolvedValueOnce(undefined)
    const service = new QueueProjectionService()

    await expect(
      service.publish([queuedTask("task-1", "One")])
    ).rejects.toThrow("session unavailable")
    await service.publish([queuedTask("task-2", "Two")])

    expect(sessionSet).toHaveBeenCalledTimes(2)
    expect(setBadgeText).toHaveBeenCalledTimes(1)
  })
})

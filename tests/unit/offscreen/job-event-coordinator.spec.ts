import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  OffscreenJobEventCoordinator,
  type OffscreenJobRecord,
} from "@/entrypoints/offscreen/job-event-coordinator"
import { OFFSCREEN_HEARTBEAT_INTERVAL_MS } from "@/src/constants/timeouts"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createOffscreenDispatchFingerprint } from "@/src/runtime/offscreen-job-fingerprint"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"

type Renewal = {
  success: true
  disposition: "renewed" | "stale_or_reordered" | "lease_not_current"
}
type RenewalMessage = RuntimeMessageRequest<
  "OFFSCREEN_JOB_ACCEPTED" | "OFFSCREEN_JOB_HEARTBEAT"
>

const DOCUMENT_ID = "offscreen-document-1"

async function createRecord(): Promise<OffscreenJobRecord> {
  const request: Omit<
    RuntimeMessageRequest<"OFFSCREEN_DOWNLOAD_CHAPTER">["payload"],
    "fingerprint"
  > = {
    jobId: "job-1",
    attempt: 1,
    taskId: "task-1",
    seriesKey: "shonenjumpplus:series-1",
    book: { siteIntegrationId: "shonenjumpplus", seriesTitle: "Series" },
    chapter: {
      id: "chapter-1",
      title: "Chapter 1",
      url: "https://shonenjumpplus.com/episode/1",
      index: 1,
      resolvedPath: "Series/Chapter 1.cbz",
    },
    settingsSnapshot: createTaskSettingsSnapshot(
      DEFAULT_SETTINGS,
      "shonenjumpplus"
    ),
    saveMode: "downloads-api",
  }
  return {
    request: {
      ...request,
      fingerprint: await createOffscreenDispatchFingerprint(request),
    },
    integrationContext: undefined,
    controller: new AbortController(),
    stage: "accepted",
    sequence: 0,
    status: "active",
    promise: new Promise(() => {}),
    heartbeatInFlight: false,
    eventTail: Promise.resolve(),
    updatedAt: Date.now(),
  }
}

describe("offscreen job renewal", () => {
  const sendMessage = vi.fn<(message: RenewalMessage) => Promise<Renewal>>()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-29T12:00:00Z"))
    sendMessage.mockReset().mockResolvedValue({
      success: true,
      disposition: "renewed",
    })
    vi.stubGlobal("chrome", { runtime: { sendMessage } })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("renews an active lease once at a time and stops after terminal completion", async () => {
    const record = await createRecord()
    const coordinator = new OffscreenJobEventCoordinator(DOCUMENT_ID, {
      pruneTerminalJobs: vi.fn(),
    })
    await coordinator.sendJobAccepted(record)
    const pending = Promise.withResolvers<Renewal>()
    sendMessage.mockReturnValueOnce(pending.promise)
    coordinator.startJobHeartbeat(record)

    await vi.advanceTimersByTimeAsync(OFFSCREEN_HEARTBEAT_INTERVAL_MS)
    expect(sendMessage).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2 * OFFSCREEN_HEARTBEAT_INTERVAL_MS)
    expect(sendMessage).toHaveBeenCalledTimes(2)

    pending.resolve({ success: true, disposition: "renewed" })
    await vi.advanceTimersByTimeAsync(0)
    expect(sendMessage).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(OFFSCREEN_HEARTBEAT_INTERVAL_MS)
    expect(sendMessage.mock.calls.map(([message]) => message.type)).toEqual([
      "OFFSCREEN_JOB_ACCEPTED",
      "OFFSCREEN_JOB_HEARTBEAT",
      "OFFSCREEN_JOB_HEARTBEAT",
    ])
    expect(
      sendMessage.mock.calls.map(([message]) => message.payload.sequence)
    ).toEqual([1, 2, 3])
    for (const [message] of sendMessage.mock.calls) {
      expect(message.payload).toMatchObject({
        jobId: record.request.jobId,
        attempt: record.request.attempt,
        taskId: record.request.taskId,
        chapterId: record.request.chapter.id,
        fingerprint: record.request.fingerprint,
        documentInstanceId: DOCUMENT_ID,
      })
    }

    record.status = "terminal"
    coordinator.stopJobHeartbeat(record)
    expect(vi.getTimerCount()).toBe(0)
    await coordinator.sendJobHeartbeat(record)
    await vi.advanceTimersByTimeAsync(2 * OFFSCREEN_HEARTBEAT_INTERVAL_MS)
    expect(sendMessage).toHaveBeenCalledTimes(3)
  })

  it.each(["renewed", "stale_or_reordered"] as const)(
    "keeps authority after %s renewal and cancels after the lease is replaced",
    async (disposition) => {
      const record = await createRecord()
      const pruneTerminalJobs = vi.fn()
      const coordinator = new OffscreenJobEventCoordinator(DOCUMENT_ID, {
        pruneTerminalJobs,
      })
      sendMessage.mockResolvedValueOnce({ success: true, disposition })
      await coordinator.sendJobAccepted(record)
      expect(record.status).toBe("active")
      expect(record.controller.signal.aborted).toBe(false)
      coordinator.startJobHeartbeat(record)

      sendMessage.mockResolvedValueOnce({
        success: true,
        disposition: "lease_not_current",
      })
      await vi.advanceTimersByTimeAsync(OFFSCREEN_HEARTBEAT_INTERVAL_MS)
      expect(record.status).toBe("canceled")
      expect(record.controller.signal.aborted).toBe(true)
      expect(record.controller.signal.reason).toBeInstanceOf(Error)
      expect(pruneTerminalJobs).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(2 * OFFSCREEN_HEARTBEAT_INTERVAL_MS)
      expect(sendMessage).toHaveBeenCalledTimes(2)
    }
  )
})

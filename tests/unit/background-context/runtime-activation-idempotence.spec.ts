import { afterEach, describe, expect, it, vi } from "vitest"
import {
  backgroundOutputRuntime,
  disposeBackgroundOutputRuntime,
  type BackgroundOutputRuntime,
} from "@/tests/integration/background-output-runtime"

let runtime: BackgroundOutputRuntime | undefined

afterEach(async () => {
  try {
    await disposeBackgroundOutputRuntime()
  } finally {
    runtime = undefined
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})

describe("runtime startup activation", () => {
  it("preserves an activated dispatch when later readiness observes changed MangaDex preferences", async () => {
    runtime = await backgroundOutputRuntime()
    await runtime.enablement.setEnabled("mangadex", true)
    await runtime.kernel.refreshIntegrations()
    await runtime.siteSettings.updateForSite("mangadex", {
      imageQuality: "data-saver",
    })
    const { lease } = await runtime.start("captured-dispatch", "mangadex")
    const startup = runtime.createKernel()
    startup.markControlReady()
    startup.start()
    await startup.ensure("runtime-ready")
    await vi.waitFor(
      () => {
        expect(runtime!.dispatches).toHaveLength(2)
        expect(runtime!.scheduler.isTaskActive(lease.taskId)).toBe(false)
      },
      { interval: 1, timeout: 2_000 }
    )
    expect(await runtime.queue.getActiveDispatchLease()).toEqual(lease)
    expect(runtime.dispatches[1].payload).toMatchObject({
      jobId: lease.jobId,
      fingerprint: lease.fingerprint,
      integrationContext: {
        data: { mangadexConfiguredImageQuality: "data-saver" },
      },
    })

    await runtime.siteSettings.updateForSite("mangadex", {
      imageQuality: "data",
    })
    await Promise.all([
      startup.ensure("runtime-ready"),
      startup.ensure("runtime-ready"),
    ])
    await vi.advanceTimersByTimeAsync(1)

    expect(await runtime.queue.getActiveDispatchLease()).toEqual(lease)
    expect(await runtime.queue.getTask(lease.taskId)).toMatchObject({
      status: "downloading",
      chapters: [expect.objectContaining({ status: "downloading" })],
    })
    expect(
      runtime.worker.getJobState({
        ...lease,
        documentInstanceId: lease.documentInstanceId!,
      })
    ).toMatchObject({ status: "active" })
  })
})

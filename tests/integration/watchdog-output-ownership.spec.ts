import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ensureLivenessAlarm,
  LIVENESS_ALARM_NAME,
  refreshLivenessAlarmForDurableWork,
} from "@/entrypoints/background/offscreen-lifecycle"
import {
  backgroundOutputRuntime,
  disposeBackgroundOutputRuntime,
  type BackgroundOutputRuntime,
} from "./background-output-runtime"

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

describe("watchdog output ownership", () => {
  it("replaces a periodic alarm with a one-shot wakeup and stops rearming an idle profile", async () => {
    runtime = await backgroundOutputRuntime()
    runtime.alarms.set(LIVENESS_ALARM_NAME, {
      name: LIVENESS_ALARM_NAME,
      scheduledTime: Date.now(),
      periodInMinutes: 1,
      persistAcrossSessions: true,
    })
    await ensureLivenessAlarm()
    expect(runtime.alarms.get(LIVENESS_ALARM_NAME)).toMatchObject({
      persistAcrossSessions: true,
      periodInMinutes: undefined,
    })
    await runtime.alarm()
    expect(runtime.alarms.has(LIVENESS_ALARM_NAME)).toBe(false)
    expect(await runtime.queue.getActiveDispatchLease()).toBeNull()
    expect(await runtime.native.hasLiveDependencies()).toBe(false)
  })

  it("retains a wakeup for an admitted task between admission and its first chapter dispatch", async () => {
    runtime = await backgroundOutputRuntime()
    await runtime.enqueue("admitted-task")
    expect(
      (
        await runtime.queue.startDownloadTask({
          taskId: "admitted-task",
          now: Date.now(),
        })
      ).outcome
    ).toBe("applied")
    expect(await runtime.queue.getActiveDispatchLease()).toBeNull()
    await refreshLivenessAlarmForDurableWork(runtime.queue, runtime.native)
    expect(runtime.alarms.has(LIVENESS_ALARM_NAME)).toBe(true)

    runtime.holdProgress()
    await runtime.alarm()
    await vi.waitFor(
      async () =>
        expect(await runtime!.queue.getActiveDispatchLease()).toMatchObject({
          documentInstanceId: runtime!.worker.documentInstanceId,
        }),
      { interval: 1, timeout: 2_000 }
    )
    const lease = (await runtime.queue.getActiveDispatchLease())!
    expect(lease).toMatchObject({ taskId: "admitted-task" })
    expect(
      runtime.worker.getJobState({
        ...lease,
        documentInstanceId: lease.documentInstanceId!,
      })
    ).toMatchObject({ status: "active" })
    expect(runtime.alarms.has(LIVENESS_ALARM_NAME)).toBe(true)
  })

  it("keeps native transfers and their document alive after the producer has released its lease", async () => {
    runtime = await backgroundOutputRuntime()
    await runtime.enqueue("native-transfer")
    expect(await runtime.executor.execute("native-transfer")).toBe("active")
    await vi.waitFor(
      async () => {
        expect(await runtime!.queue.getActiveDispatchLease()).toBeNull()
        expect(await runtime!.native.hasLiveDependencies()).toBe(true)
      },
      { interval: 1, timeout: 2_000 }
    )
    const before = await runtime.nativeRepository.snapshot()
    expect(Object.values(before.outputsByOutputId)).toHaveLength(2)
    expect(
      Object.values(before.outputsByOutputId).map((item) => item.phase)
    ).toEqual(["waiting", "waiting"])
    await runtime.alarm()
    expect(runtime.alarms.has(LIVENESS_ALARM_NAME)).toBe(true)
    expect(runtime.documentPresent()).toBe(true)
    expect(await runtime.nativeRepository.snapshot()).toEqual(before)
    expect(await runtime.history.getDownloadedChapters()).toEqual([])
  })
})

import { afterEach, describe, expect, it, vi } from "vitest"
import { runTaskSideEffectExclusive } from "@/entrypoints/background/download-task-side-effect-gate"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
import {
  LOCAL_STORAGE_KEYS,
  SESSION_STORAGE_KEYS,
} from "@/src/runtime/storage-keys"
import {
  ensureLivenessAlarm,
  LIVENESS_ALARM_NAME,
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
    vi.restoreAllMocks()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})

describe("startup and watchdog continuation", () => {
  it("continues to a queued successor after publishing an interrupted unaccepted dispatch", async () => {
    runtime = await backgroundOutputRuntime()
    await runtime.settingsRepository.replaceSettings({
      ...runtime.settings,
      notifications: true,
    })
    const { lease } = await runtime.admitUnbound("unaccepted-task")
    await runtime.enqueue("queued-successor")
    runtime.holdProgress()
    await ensureLivenessAlarm()
    await runtime.expire()
    await runtime.alarm()
    await vi.waitFor(
      async () =>
        expect(await runtime!.queue.getActiveDispatchLease()).toMatchObject({
          taskId: "queued-successor",
          documentInstanceId: runtime!.worker.documentInstanceId,
        }),
      { interval: 1, timeout: 2_000 }
    )
    expect(await runtime.queue.getTask(lease.taskId)).toMatchObject({
      status: "failed",
    })
    expect(runtime.notifications).toEqual(["task_error_unaccepted-task"])
    expect(runtime.alarms.has(LIVENESS_ALARM_NAME)).toBe(true)
  })

  it("retains a continuation wakeup before publishing an interrupted unaccepted dispatch", async () => {
    runtime = await backgroundOutputRuntime()
    await runtime.settingsRepository.replaceSettings({
      ...runtime.settings,
      notifications: true,
    })
    const { lease } = await runtime.admitUnbound("unaccepted-task")
    await runtime.enqueue("queued-successor")
    runtime.holdNotifications()
    await ensureLivenessAlarm()
    await runtime.expire()
    await runtime.alarm()
    await vi.waitFor(() => expect(runtime!.notifications).toHaveLength(1), {
      interval: 1,
      timeout: 2_000,
    })

    expect(await runtime.queue.getTask(lease.taskId)).toMatchObject({
      status: "failed",
    })
    expect(await runtime.queue.getTask("queued-successor")).toMatchObject({
      status: "queued",
    })
    expect(await runtime.queue.getActiveDispatchLease()).toBeNull()
    expect(runtime.documentPresent()).toBe(false)
    expect(
      runtime.alarms.has(LIVENESS_ALARM_NAME),
      JSON.stringify({
        notifications: runtime.notifications,
        queue: await runtime.queue.getQueue(),
        alarms: [...runtime.alarms.values()],
      })
    ).toBe(true)

    runtime.releaseNotifications()
  })
})

async function admittedPair() {
  runtime = await backgroundOutputRuntime()
  const { lease } = await runtime.admitUnbound("unaccepted-task")
  await runtime.enqueue("queued-successor")
  await ensureLivenessAlarm()
  await runtime.expire()
  return { runtime, lease }
}

function holdCommittedQueueProjection(current: BackgroundOutputRuntime) {
  const gate = Promise.withResolvers<void>()
  const originalSet = chrome.storage.session.set
  let held = false
  const spy = vi
    .spyOn(chrome.storage.session, "set")
    .mockImplementation(async (values: Record<string, unknown>) => {
      const committedQueue = current.local[
        LOCAL_STORAGE_KEYS.downloadQueue
      ] as Array<{ id: string; status: string }>
      if (
        !held &&
        Object.hasOwn(values, SESSION_STORAGE_KEYS.queueView) &&
        current.local[LOCAL_STORAGE_KEYS.activeDispatchLease] === null &&
        committedQueue.some(
          (task) => task.id === "unaccepted-task" && task.status === "failed"
        )
      ) {
        held = true
        await gate.promise
      }
      await originalSet(values)
    })
  return {
    held: () => held,
    release: () => gate.resolve(),
    restore: () => spy.mockRestore(),
  }
}

describe("unbound recovery publication boundaries", () => {
  it("retains continuation authority while the committed queue projection is still awaiting Chrome", async () => {
    const { runtime: current } = await admittedPair()
    const projection = holdCommittedQueueProjection(current)
    try {
      await current.alarm()
      await vi.waitFor(() => expect(projection.held()).toBe(true), {
        interval: 1,
        timeout: 2_000,
      })
      expect(await current.queue.getTask("unaccepted-task")).toMatchObject({
        status: "failed",
      })
      expect(await current.queue.getTask("queued-successor")).toMatchObject({
        status: "queued",
      })
      expect(await current.queue.getActiveDispatchLease()).toBeNull()
      expect(current.documentPresent()).toBe(false)
      expect(await current.native.hasLiveDependencies()).toBe(false)
      expect(
        current.alarms.has(LIVENESS_ALARM_NAME),
        JSON.stringify({
          localQueue: current.local[LOCAL_STORAGE_KEYS.downloadQueue],
          localLease: current.local[LOCAL_STORAGE_KEYS.activeDispatchLease],
          alarms: [...current.alarms.values()],
        })
      ).toBe(true)
    } finally {
      projection.release()
      await vi.advanceTimersByTimeAsync(1)
      projection.restore()
    }
  })

  it("admits the successor after the held committed projection resolves", async () => {
    const { runtime: current } = await admittedPair()
    const projection = holdCommittedQueueProjection(current)
    try {
      current.holdProgress()
      await current.alarm()
      await vi.waitFor(() => expect(projection.held()).toBe(true), {
        interval: 1,
        timeout: 2_000,
      })
      expect(await current.queue.getActiveDispatchLease()).toBeNull()
      projection.release()
      await vi.waitFor(
        async () =>
          expect(await current.queue.getActiveDispatchLease()).toMatchObject({
            taskId: "queued-successor",
            documentInstanceId: current.worker.documentInstanceId,
          }),
        { interval: 1, timeout: 2_000 }
      )
      expect(current.alarms.has(LIVENESS_ALARM_NAME)).toBe(true)
    } finally {
      projection.release()
      projection.restore()
    }
  })

  it("retains the exact unbound recovery lease when committing interruption fails", async () => {
    const { runtime: current, lease } = await admittedPair()
    const originalSet = chrome.storage.local.set
    let refused = false
    const spy = vi
      .spyOn(chrome.storage.local, "set")
      .mockImplementation(async (values: Record<string, unknown>) => {
        if (
          !refused &&
          values[LOCAL_STORAGE_KEYS.activeDispatchLease] === null &&
          Object.hasOwn(values, LOCAL_STORAGE_KEYS.downloadQueue)
        ) {
          refused = true
          throw new Error("Interruption persistence unavailable")
        }
        await originalSet(values)
      })
    try {
      await current.alarm()
      await vi.waitFor(() => expect(refused).toBe(true), {
        interval: 1,
        timeout: 2_000,
      })
      await vi.waitFor(
        () => expect(current.alarms.has(LIVENESS_ALARM_NAME)).toBe(true),
        { interval: 1, timeout: 2_000 }
      )
      expect(await current.queue.getActiveDispatchLease()).toEqual(lease)
      expect(current.local[LOCAL_STORAGE_KEYS.activeDispatchLease]).toEqual(
        lease
      )
      expect(await current.queue.getTask("unaccepted-task")).toMatchObject({
        status: "downloading",
      })
      expect(await current.queue.getTask("queued-successor")).toMatchObject({
        status: "queued",
      })
      spy.mockRestore()
      current.holdProgress()
      await current.alarm()
      await vi.waitFor(
        async () =>
          expect(await current.queue.getActiveDispatchLease()).toMatchObject({
            taskId: "queued-successor",
          }),
        { interval: 1, timeout: 2_000 }
      )
    } finally {
      spy.mockRestore()
    }
  })

  it("preserves the wakeup before clearing progress for a canceled unbound owner", async () => {
    const { runtime: current } = await admittedPair()
    await expect(
      current.cancellation.cancelTask("unaccepted-task", "cancel-unbound")
    ).resolves.toMatchObject({ queueCanContinue: false })
    const gate = Promise.withResolvers<void>()
    const originalSet = chrome.storage.session.set
    let held = false
    const spy = vi
      .spyOn(chrome.storage.session, "set")
      .mockImplementation(async (values: Record<string, unknown>) => {
        if (
          !held &&
          values[SESSION_STORAGE_KEYS.activeTaskProgress] === null &&
          current.local[LOCAL_STORAGE_KEYS.activeDispatchLease] === null
        ) {
          held = true
          await gate.promise
        }
        await originalSet(values)
      })
    try {
      await current.alarm()
      await vi.waitFor(() => expect(held).toBe(true), {
        interval: 1,
        timeout: 2_000,
      })
      expect(await current.queue.getTask("unaccepted-task")).toMatchObject({
        status: "canceled",
      })
      expect(await current.queue.getTask("queued-successor")).toMatchObject({
        status: "queued",
      })
      expect(await current.queue.getActiveDispatchLease()).toBeNull()
      expect(current.alarms.has(LIVENESS_ALARM_NAME)).toBe(true)
    } finally {
      gate.resolve()
      await vi.advanceTimersByTimeAsync(1)
      spy.mockRestore()
    }
  })
})

describe("conservative unbound continuation priming", () => {
  it("coalesces competing expired recoveries and retires their wakeup after one exact cleanup drains the profile", async () => {
    const runtime = await backgroundOutputRuntime()
    const { lease } = await runtime.admitUnbound("unaccepted-task")
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const holder = runTaskSideEffectExclusive(lease.taskId, async () => {
      entered.resolve()
      await release.promise
    })
    await entered.promise
    try {
      await ensureLivenessAlarm()
      await runtime.expire()
      await runtime.alarm()
      expect(runtime.alarms.get(LIVENESS_ALARM_NAME)).toMatchObject({
        periodInMinutes: undefined,
      })
      expect(runtime.closeCount()).toBe(0)
      await runtime.alarm()
      expect(runtime.alarms.get(LIVENESS_ALARM_NAME)).toMatchObject({
        periodInMinutes: undefined,
      })
      expect(runtime.closeCount()).toBe(0)
      release.resolve()
      await holder
      await vi.waitFor(
        async () => {
          expect(await runtime.queue.getTask(lease.taskId)).toMatchObject({
            status: "failed",
          })
          expect(await runtime.queue.getActiveDispatchLease()).toBeNull()
          expect(runtime.alarms.has(LIVENESS_ALARM_NAME)).toBe(false)
        },
        { interval: 1, timeout: 2_000 }
      )
      expect(runtime.closeCount()).toBe(1)
      expect(runtime.cancellations).toHaveLength(0)
      expect(await runtime.native.hasLiveDependencies()).toBe(false)
    } finally {
      release.resolve()
      await holder
    }
  })

  it("preserves the original lease and document when Chrome rejects alarm priming before cleanup", async () => {
    const runtime = await backgroundOutputRuntime()
    const { lease } = await runtime.admitUnbound("unaccepted-task")
    await runtime.enqueue("queued-successor")
    await ensureLivenessAlarm()
    await runtime.expire()
    const originalCreate = chrome.alarms.create
    let rejected = false
    const spy = vi
      .spyOn(chrome.alarms, "create")
      .mockImplementation(async (name, info) => {
        if (!rejected && name === LIVENESS_ALARM_NAME) {
          rejected = true
          throw new Error("Alarm persistence unavailable")
        }
        await originalCreate(name, info)
      })
    try {
      await runtime.alarm()
      await vi.waitFor(
        () => {
          expect(rejected).toBe(true)
          expect(runtime.alarms.has(LIVENESS_ALARM_NAME)).toBe(true)
        },
        { interval: 1, timeout: 2_000 }
      )
      expect(await runtime.queue.getActiveDispatchLease()).toEqual(lease)
      expect(await runtime.queue.getTask(lease.taskId)).toMatchObject({
        status: "downloading",
      })
      expect(await runtime.queue.getTask("queued-successor")).toMatchObject({
        status: "queued",
      })
      expect(runtime.closeCount()).toBe(0)
      expect(runtime.documentPresent()).toBe(true)
      spy.mockRestore()
      runtime.holdProgress()
      await runtime.alarm()
      await vi.waitFor(
        async () =>
          expect(await runtime.queue.getActiveDispatchLease()).toMatchObject({
            taskId: "queued-successor",
            documentInstanceId: runtime.worker.documentInstanceId,
          }),
        { interval: 1, timeout: 2_000 }
      )
    } finally {
      spy.mockRestore()
    }
  })
})

describe("unbound watchdog current ownership", () => {
  it("rejects a captured unbound recovery after the real dispatch binds while the watchdog waits for its task gate", async () => {
    const runtime = await backgroundOutputRuntime()
    const { lease, message } = await runtime.admitUnbound("late-accepted-task")
    await ensureLivenessAlarm()
    await runtime.expire()
    runtime.holdProgress()
    const entered = Promise.withResolvers<void>()
    const deliver = Promise.withResolvers<void>()
    const bound = Promise.withResolvers<void>()
    const releaseTaskGate = Promise.withResolvers<void>()
    const dispatchOwner = runTaskSideEffectExclusive(lease.taskId, async () => {
      entered.resolve()
      await deliver.promise
      const acknowledgment = await sendRuntimeMessage(message)
      if (!acknowledgment.success) throw new Error(acknowledgment.error)
      expect(
        (await runtime.queue.bindDispatchLeaseIncarnation(acknowledgment))
          .outcome
      ).toBe("applied")
      bound.resolve()
      await releaseTaskGate.promise
    })
    await entered.promise
    const publication = Promise.withResolvers<void>()
    const originalSet = chrome.storage.session.set
    let progressHeld = false
    const spy = vi
      .spyOn(chrome.storage.session, "set")
      .mockImplementation(async (values: Record<string, unknown>) => {
        if (
          !progressHeld &&
          values[SESSION_STORAGE_KEYS.activeTaskProgress] === null
        ) {
          progressHeld = true
          await publication.promise
        }
        await originalSet(values)
      })
    try {
      await runtime.alarm()
      expect(runtime.documentPresent()).toBe(true)
      deliver.resolve()
      await bound.promise
      releaseTaskGate.resolve()
      await dispatchOwner
      await vi.waitFor(() => expect(progressHeld).toBe(true), {
        interval: 1,
        timeout: 2_000,
      })
      expect(runtime.closeCount()).toBe(0)
      expect(runtime.cancellations).toHaveLength(0)
      expect(await runtime.queue.getTask(lease.taskId)).toMatchObject({
        status: "downloading",
      })
      const current = (await runtime.queue.getActiveDispatchLease())!
      expect(current).toMatchObject({
        jobId: lease.jobId,
        documentInstanceId: runtime.worker.documentInstanceId,
      })
      expect(
        runtime.worker.getJobState({
          ...current,
          documentInstanceId: current.documentInstanceId!,
        })
      ).toMatchObject({ status: "active" })
      expect(runtime.alarms.get(LIVENESS_ALARM_NAME)).toMatchObject({
        periodInMinutes: undefined,
        persistAcrossSessions: true,
      })
      expect(
        runtime.alarms.get(LIVENESS_ALARM_NAME)!.scheduledTime
      ).toBeGreaterThan(Date.now())
      publication.resolve()
      await vi.waitFor(
        () => expect(runtime.alarms.has(LIVENESS_ALARM_NAME)).toBe(true),
        { interval: 1, timeout: 2_000 }
      )
    } finally {
      deliver.resolve()
      releaseTaskGate.resolve()
      publication.resolve()
      await dispatchOwner
      spy.mockRestore()
    }
  })
})

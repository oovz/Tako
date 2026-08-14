import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ActiveTaskProgressSnapshot } from "@/src/runtime/active-task-progress"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"

function progress(
  overrides: Partial<
    Omit<ActiveTaskProgressSnapshot, "generation" | "revision" | "updatedAt">
  > = {}
): Omit<ActiveTaskProgressSnapshot, "generation" | "revision" | "updatedAt"> {
  return {
    taskId: "task-1",
    chapterId: "chapter-1",
    chapterTitle: "Chapter 1",
    imagesProcessed: 1,
    totalImages: 10,
    activeChapterCount: 1,
    activeChapters: [
      {
        chapterId: "chapter-1",
        chapterTitle: "Chapter 1",
        imagesProcessed: 1,
        totalImages: 10,
        stage: "downloading",
        phaseFraction: 0.1,
        updatedAt: 100,
      },
    ],
    stage: "downloading",
    phaseFraction: 0.1,
    overallFraction: 0.05,
    outputCommitted: false,
    status: "downloading",
    ...overrides,
  }
}

function makePort() {
  let disconnectListener: (() => void) | undefined
  const port = {
    name: "tako-active-task-progress",
    postMessage: vi.fn(),
    onDisconnect: {
      addListener: vi.fn((listener: () => void) => {
        disconnectListener = listener
      }),
    },
  } as unknown as chrome.runtime.Port
  return {
    port,
    disconnect: () => disconnectListener?.(),
  }
}

describe("active task progress bus", () => {
  const sessionGet = vi.fn(async () => ({}) as Record<string, unknown>)
  const sessionSet = vi.fn(async () => undefined)

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    sessionGet.mockResolvedValue({})
    sessionSet.mockResolvedValue(undefined)
    vi.stubGlobal("chrome", {
      storage: {
        session: {
          get: sessionGet,
          set: sessionSet,
        },
      },
    })
  })

  it("broadcasts every revision while bounding recovery snapshot writes", async () => {
    const bus =
      await import("@/entrypoints/background/active-task-progress-bus")
    const { port } = makePort()
    bus.registerActiveTaskProgressPort(port)
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1))
    vi.mocked(port.postMessage).mockClear()

    await bus.publishActiveTaskProgress(progress(), { now: 100 })
    await bus.publishActiveTaskProgress(
      progress({ imagesProcessed: 2, phaseFraction: 0.2 }),
      { now: 500 }
    )
    await bus.publishActiveTaskProgress(
      progress({ stage: "archiving", phaseFraction: 0.1 }),
      { now: 600 }
    )

    expect(port.postMessage).toHaveBeenCalledTimes(3)
    expect(
      vi.mocked(port.postMessage).mock.calls.map(([message]) => message)
    ).toEqual([
      expect.objectContaining({ revision: 1 }),
      expect.objectContaining({ revision: 2 }),
      expect.objectContaining({ revision: 3 }),
    ])
    expect(sessionSet).toHaveBeenCalledTimes(2)
    expect(sessionSet).toHaveBeenLastCalledWith({
      [SESSION_STORAGE_KEYS.activeTaskProgress]: expect.objectContaining({
        revision: 3,
        stage: "archiving",
      }),
      [SESSION_STORAGE_KEYS.activeTaskProgressRevision]: 3,
      [SESSION_STORAGE_KEYS.activeTaskProgressGeneration]: expect.any(String),
    })
  })

  it("hydrates a new Port and stops broadcasting after disconnect", async () => {
    sessionGet.mockResolvedValue({
      [SESSION_STORAGE_KEYS.activeTaskProgressRevision]: 4,
      [SESSION_STORAGE_KEYS.activeTaskProgress]: {
        ...progress(),
        generation: "persisted-generation",
        revision: 4,
        updatedAt: 40,
      },
    })
    const bus =
      await import("@/entrypoints/background/active-task-progress-bus")
    const { port, disconnect } = makePort()
    bus.registerActiveTaskProgressPort(port)

    await vi.waitFor(() => {
      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ revision: 4 })
      )
    })
    disconnect()
    vi.mocked(port.postMessage).mockClear()
    await bus.publishActiveTaskProgress(progress(), { now: 1_100 })

    expect(port.postMessage).not.toHaveBeenCalled()
  })

  it("keeps live Port delivery working when snapshot persistence fails", async () => {
    sessionSet.mockRejectedValueOnce(new Error("session unavailable"))
    const bus =
      await import("@/entrypoints/background/active-task-progress-bus")
    const { port } = makePort()
    bus.registerActiveTaskProgressPort(port)
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1))
    vi.mocked(port.postMessage).mockClear()

    await expect(
      bus.publishActiveTaskProgress(progress(), { now: 100 })
    ).resolves.toEqual(expect.objectContaining({ revision: 1 }))
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 1 })
    )
  })

  it("shares one hydration barrier across concurrent first publications", async () => {
    let resolveHydration!: (value: Record<string, unknown>) => void
    sessionGet.mockImplementationOnce(
      async () =>
        await new Promise<Record<string, unknown>>((resolve) => {
          resolveHydration = resolve
        })
    )
    const bus =
      await import("@/entrypoints/background/active-task-progress-bus")

    const first = bus.publishActiveTaskProgress(progress(), { now: 100 })
    const second = bus.publishActiveTaskProgress(
      progress({ imagesProcessed: 2 }),
      { now: 200 }
    )
    expect(sessionGet).toHaveBeenCalledTimes(1)
    resolveHydration({})

    const [firstSnapshot, secondSnapshot] = await Promise.all([first, second])
    expect(firstSnapshot?.revision).toBe(1)
    expect(secondSnapshot?.revision).toBe(2)
    await expect(bus.getActiveTaskProgressSnapshot()).resolves.toMatchObject({
      revision: 2,
      progress: expect.objectContaining({ revision: 2 }),
    })
  })

  it("advances the projection after an authoritative destination commit", async () => {
    const bus =
      await import("@/entrypoints/background/active-task-progress-bus")
    await bus.publishActiveTaskProgress(progress({ overallFraction: 0.49 }), {
      now: 100,
    })

    await bus.settleActiveTaskProgressChapter({
      taskId: "task-1",
      chapterId: "chapter-1",
      chapters: [
        { id: "chapter-1", status: "completed" },
        { id: "chapter-2", status: "queued" },
      ],
      destinationCommitted: true,
    })

    await expect(bus.getActiveTaskProgressSnapshot()).resolves.toMatchObject({
      progress: {
        taskId: "task-1",
        activeChapterCount: 0,
        stage: "accepted",
        overallFraction: 0.5,
        outputCommitted: true,
      },
    })
  })
})

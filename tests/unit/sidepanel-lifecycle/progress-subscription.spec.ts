// @vitest-environment happy-dom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useActiveTaskProgress } from "@/entrypoints/sidepanel/hooks/useActiveTaskProgress"
import { SESSION_STORAGE_KEYS as keys } from "@/src/runtime/storage-keys"

function event<T extends (...args: never[]) => void>() {
  const listeners = new Set<T>()
  return {
    addListener: (listener: T) => listeners.add(listener),
    removeListener: (listener: T) => listeners.delete(listener),
    emit: (...args: Parameters<T>) =>
      listeners.forEach((listener) => listener(...args)),
  }
}

function port() {
  return {
    onMessage: event<(message: unknown) => void>(),
    onDisconnect: event<() => void>(),
    disconnect: vi.fn(),
  }
}

let root: Root
let container: HTMLDivElement
let stored: Record<string, unknown>
let state: ReturnType<typeof useActiveTaskProgress>
let first: ReturnType<typeof port>
let second: ReturnType<typeof port>
const changes =
  event<(changes: Record<string, unknown>, area: string) => void>()
const get = vi.fn()
const connect = vi.fn()

function View() {
  state = useActiveTaskProgress()
  return createElement("output", null, state.hydrated ? "ready" : "loading")
}

function snapshot(generation: string, revision: number) {
  return {
    [keys.activeTaskProgress]: progress(generation, revision),
    [keys.activeTaskProgressGeneration]: generation,
    [keys.activeTaskProgressRevision]: revision,
  }
}

function progress(generation: string, revision: number) {
  return {
    generation,
    revision,
    updatedAt: 1,
    taskId: `${generation}:${revision}`,
    imagesProcessed: 0,
    totalImages: 0,
    activeChapterCount: 0,
    activeChapters: [],
    stage: "downloading",
    phaseFraction: 0,
    outputCommitted: false,
    status: "downloading",
  }
}

function message(
  generation: string,
  revision: number,
  progress: unknown = null
) {
  return { type: "ACTIVE_TASK_PROGRESS", generation, revision, progress }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  stored = snapshot("worker-1", 5)
  first = port()
  second = port()
  connect.mockReset().mockReturnValueOnce(first).mockReturnValue(second)
  get.mockReset().mockImplementation(async () => stored)
  vi.stubGlobal("chrome", {
    storage: { session: { get }, onChanged: changes },
    runtime: { connect },
  })
  container = document.createElement("div")
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it("waits for storage hydration before connecting and validates live snapshot identities", async () => {
  const pending = Promise.withResolvers<Record<string, unknown>>()
  get.mockReturnValue(pending.promise)
  await act(async () => root.render(createElement(View)))
  expect(container.textContent).toBe("loading")
  expect(connect).not.toHaveBeenCalled()
  await act(async () => pending.resolve(stored))
  expect(container.textContent).toBe("ready")
  expect(connect).toHaveBeenCalledTimes(1)
  expect(state.progress?.taskId).toBe("worker-1:5")
  await act(async () => {
    first.onMessage.emit(message("worker-1", 6, { taskId: "invalid" }))
    first.onMessage.emit(message("worker-1", 4))
  })
  expect(state.progress?.taskId).toBe("worker-1:5")
  await act(async () =>
    first.onMessage.emit(message("worker-1", 6, progress("worker-1", 6)))
  )
  expect(state.progress?.taskId).toBe("worker-1:6")
})

it("recovers a disconnected port, rejects its old messages and cancels reconnect on unmount", async () => {
  await act(async () => root.render(createElement(View)))
  await act(async () => first.onMessage.emit(message("worker-1", 6)))
  await act(async () => first.onDisconnect.emit())
  await act(async () => vi.advanceTimersByTimeAsync(250))
  expect(connect).toHaveBeenCalledTimes(2)
  await act(async () => {
    first.onMessage.emit(message("stale-worker", 999))
    second.onMessage.emit(message("worker-2", 1, progress("worker-2", 1)))
  })
  expect(state.hydrated).toBe(true)
  expect(state.progress?.taskId).toBe("worker-2:1")
  await act(async () => {
    first.onMessage.emit(message("stale-worker", 999))
  })
  expect(state.progress?.taskId).toBe("worker-2:1")
  await act(async () => second.onDisconnect.emit())
  act(() => root.unmount())
  await act(async () => vi.advanceTimersByTimeAsync(1_000))
  expect(connect).toHaveBeenCalledTimes(2)
})

it("does not reconnect when disconnected-port recovery settles after unmount", async () => {
  await act(async () => root.render(createElement(View)))
  expect(connect).toHaveBeenCalledTimes(1)
  const pending = Promise.withResolvers<Record<string, unknown>>()
  get.mockReturnValueOnce(pending.promise)
  const readsBeforeDisconnect = get.mock.calls.length

  await act(async () => first.onDisconnect.emit())
  expect(get).toHaveBeenCalledTimes(readsBeforeDisconnect + 1)
  act(() => root.unmount())
  await act(async () => pending.resolve(snapshot("worker-2", 1)))
  await act(async () => vi.advanceTimersByTimeAsync(1_000))

  expect(connect).toHaveBeenCalledTimes(1)
  expect(get).toHaveBeenCalledTimes(readsBeforeDisconnect + 1)
})

it("waits for progress data when generation and revision hydrate first", async () => {
  const data = Promise.withResolvers<Record<string, unknown>>()
  const revision = Promise.withResolvers<Record<string, unknown>>()
  const generation = Promise.withResolvers<Record<string, unknown>>()
  get.mockImplementation((key: string) => {
    if (key === keys.activeTaskProgress) return data.promise
    if (key === keys.activeTaskProgressRevision) return revision.promise
    return generation.promise
  })
  await act(async () => root.render(createElement(View)))
  await act(async () =>
    revision.resolve({ [keys.activeTaskProgressRevision]: 5 })
  )
  expect(state.hydrated).toBe(false)
  expect(connect).not.toHaveBeenCalled()
  await act(async () =>
    generation.resolve({ [keys.activeTaskProgressGeneration]: "worker-1" })
  )
  expect(state.hydrated).toBe(false)
  expect(state.progress).toBeNull()
  expect(connect).not.toHaveBeenCalled()

  await act(async () =>
    data.resolve({ [keys.activeTaskProgress]: progress("worker-1", 5) })
  )
  expect(state.hydrated).toBe(true)
  expect(state.progress?.taskId).toBe("worker-1:5")
  expect(connect).toHaveBeenCalledTimes(1)
  await act(async () =>
    first.onMessage.emit(message("worker-1", 6, progress("worker-1", 6)))
  )
  expect(state.progress?.taskId).toBe("worker-1:6")
})

it("recovers coherent progress and a later cleared projection after external disconnects", async () => {
  await act(async () => root.render(createElement(View)))
  const pending = Promise.withResolvers<Record<string, unknown>>()
  get.mockReturnValueOnce(pending.promise)
  await act(async () => first.onDisconnect.emit())
  expect(state.progress?.taskId).toBe("worker-1:5")

  stored = snapshot("worker-2", 1)
  await act(async () => pending.resolve(stored))
  expect(state.progress?.taskId).toBe("worker-2:1")
  await act(async () => vi.advanceTimersByTimeAsync(250))
  expect(connect).toHaveBeenCalledTimes(2)

  const cleared = Promise.withResolvers<Record<string, unknown>>()
  get.mockReturnValueOnce(cleared.promise)
  await act(async () => second.onDisconnect.emit())
  expect(state.progress?.taskId).toBe("worker-2:1")
  await act(async () =>
    cleared.resolve({
      [keys.activeTaskProgress]: null,
      [keys.activeTaskProgressGeneration]: "worker-2",
      [keys.activeTaskProgressRevision]: 2,
    })
  )
  expect(state.hydrated).toBe(true)
  expect(state.progress).toBeNull()
})

it.each([
  {
    mismatch: "generation",
    data: progress("worker-3", 10),
  },
  {
    mismatch: "revision",
    data: progress("worker-2", 9),
  },
])(
  "retains current progress when recovery has a mismatched $mismatch",
  async ({ data }) => {
    await act(async () => root.render(createElement(View)))
    const pending = Promise.withResolvers<Record<string, unknown>>()
    get.mockReturnValueOnce(pending.promise)
    await act(async () => first.onDisconnect.emit())
    await act(async () =>
      pending.resolve({
        [keys.activeTaskProgress]: data,
        [keys.activeTaskProgressGeneration]: "worker-2",
        [keys.activeTaskProgressRevision]: 10,
      })
    )
    expect(state.progress?.taskId).toBe("worker-1:5")
  }
)

it.each([
  { missing: "generation", key: keys.activeTaskProgressGeneration },
  { missing: "revision", key: keys.activeTaskProgressRevision },
])(
  "retains current progress when a cleared recovery lacks its $missing",
  async ({ key }) => {
    await act(async () => root.render(createElement(View)))
    const pending = Promise.withResolvers<Record<string, unknown>>()
    get.mockReturnValueOnce(pending.promise)
    await act(async () => first.onDisconnect.emit())
    const incomplete: Record<string, unknown> = {
      [keys.activeTaskProgress]: null,
      [keys.activeTaskProgressGeneration]: "worker-2",
      [keys.activeTaskProgressRevision]: 1,
    }
    delete incomplete[key]
    await act(async () => pending.resolve(incomplete))
    expect(state.progress?.taskId).toBe("worker-1:5")
  }
)

it("preserves live progress while older per-key storage reads settle and recovers after disconnect", async () => {
  await act(async () => root.render(createElement(View)))
  const data = Promise.withResolvers<Record<string, unknown>>()
  const revision = Promise.withResolvers<Record<string, unknown>>()
  const generation = Promise.withResolvers<Record<string, unknown>>()
  get.mockImplementation((key: string) => {
    if (key === keys.activeTaskProgress) return data.promise
    if (key === keys.activeTaskProgressRevision) return revision.promise
    return generation.promise
  })
  await act(async () => {
    changes.emit(
      {
        [keys.activeTaskProgress]: { newValue: progress("worker-1", 6) },
        [keys.activeTaskProgressGeneration]: { newValue: "worker-1" },
        [keys.activeTaskProgressRevision]: { newValue: 6 },
      },
      "session"
    )
    first.onMessage.emit(message("worker-2", 1, progress("worker-2", 1)))
  })
  expect(state.progress?.taskId).toBe("worker-2:1")
  await act(async () => {
    revision.resolve({ [keys.activeTaskProgressRevision]: 6 })
    generation.resolve({ [keys.activeTaskProgressGeneration]: "worker-1" })
    data.resolve({ [keys.activeTaskProgress]: progress("worker-1", 6) })
  })
  expect(state.progress?.taskId).toBe("worker-2:1")

  stored = snapshot("worker-3", 1)
  get.mockImplementation(async () => stored)
  await act(async () => first.onDisconnect.emit())
  expect(state.progress?.taskId).toBe("worker-3:1")
})

// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useDownloadsTabState } from "@/entrypoints/options/hooks/useDownloadsTabState"
import type { PendingUndoReceipt } from "@/src/domain/queue/state"

const boundary = vi.hoisted(() => ({
  send: vi.fn(),
  retainedSend: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))
vi.mock("@/src/runtime/send-runtime-message", () => ({
  sendRuntimeMessage: boundary.send,
  sendRuntimeMessageWithRetry: boundary.retainedSend,
}))
vi.mock("sonner", () => ({ toast: boundary.toast }))
let state: ReturnType<typeof useDownloadsTabState>
let root: Root
let container: HTMLDivElement
function Harness() {
  state = useDownloadsTabState()
  return null
}
async function mount() {
  await act(async () => root.render(createElement(Harness)))
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  boundary.send.mockImplementation(async (message) =>
    message.type === "GET_OPTIONS_DOWNLOAD_STATE"
      ? { success: true, data: { tasks: [], queueStorageBytes: 0 } }
      : { success: true }
  )
  boundary.retainedSend.mockResolvedValue({ success: true })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

it("exposes queued cancellation undo and refreshes after undo succeeds", async () => {
  const receipt: PendingUndoReceipt = {
    token: "cancel-token",
    type: "cancel_queued",
    expiresAt: Date.now() + 5000,
  }
  boundary.retainedSend.mockResolvedValueOnce({
    success: true,
    data: { undo: receipt },
  })
  await mount()
  await act(async () => {
    expect(await state.cancelTask("queued")).toEqual({
      success: true,
      undo: receipt,
    })
  })
  const action = boundary.toast.mock.calls[0][1].action
  boundary.send.mockClear()
  await act(async () => action.onClick())
  expect(boundary.retainedSend).toHaveBeenLastCalledWith(
    expect.objectContaining({
      type: "UNDO_QUEUE_ACTION",
      payload: { token: receipt.token },
    }),
    expect.anything()
  )
  expect(boundary.send).toHaveBeenCalledWith({
    target: "background",
    type: "GET_OPTIONS_DOWNLOAD_STATE",
  })
})

it("returns active cancellation success without offering undo", async () => {
  await mount()
  await act(async () => {
    expect(await state.cancelTask("active")).toEqual({
      success: true,
      undo: undefined,
    })
  })
  expect(boundary.toast).not.toHaveBeenCalled()
})

it("retains cancellation failure and permits a subsequent retry", async () => {
  await mount()
  boundary.retainedSend.mockRejectedValueOnce(new Error("Unavailable"))
  await act(async () => {
    expect(await state.cancelTask("queued")).toMatchObject({ success: false })
  })
  await act(async () => {
    expect(await state.cancelTask("queued")).toMatchObject({ success: true })
  })
})

it("offers history undo after removal and reports a failed undo", async () => {
  const receipt: PendingUndoReceipt = {
    token: "remove-token",
    type: "remove_history",
    expiresAt: Date.now() + 5000,
  }
  await mount()
  boundary.retainedSend.mockResolvedValueOnce({
    success: true,
    data: { undo: receipt },
  })
  await act(async () => state.removeTask("finished"))
  const action = boundary.toast.mock.calls[0][1].action
  boundary.retainedSend.mockRejectedValueOnce(new Error("Undo unavailable"))
  boundary.send.mockClear()
  await act(async () => action.onClick())
  expect(boundary.toast.error).toHaveBeenCalledOnce()
  expect(boundary.send).not.toHaveBeenCalled()
})

it.each(["retryTask", "restartTask", "removeTask"] as const)(
  "refreshes after %s succeeds and reports its failure",
  async (action) => {
    await mount()
    boundary.send.mockClear()
    await act(async () => state[action]("task"))
    expect(boundary.send).toHaveBeenCalledOnce()
    boundary.send.mockClear()
    boundary.retainedSend.mockRejectedValueOnce(
      new Error("Command unavailable")
    )
    await act(async () => state[action]("task"))
    expect(boundary.toast.error).toHaveBeenCalledOnce()
    expect(boundary.send).not.toHaveBeenCalled()
  }
)

it("keeps clear-history failure visible and refreshes a successful retry", async () => {
  await mount()
  boundary.send.mockRejectedValueOnce(new Error("Clear unavailable"))
  await act(async () => {
    expect(await state.clearTaskHistory()).toBe(false)
  })
  await act(async () => {
    expect(await state.clearTaskHistory()).toBe(true)
  })
  expect(boundary.toast.error).toHaveBeenCalledOnce()
  expect(boundary.toast.success).toHaveBeenCalledOnce()
})

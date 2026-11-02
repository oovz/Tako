// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { Toaster, toast } from "sonner"
import { useOptionsDownloadActions } from "@/entrypoints/options/hooks/useDownloadsTabState-actions"
import { useCommandCenterActions } from "@/entrypoints/sidepanel/hooks/useCommandCenterActions"
import { t } from "@/src/runtime/i18n"
import type { RuntimeMessage } from "@/src/runtime/runtime-message-contracts"

let root: Root
let container: HTMLDivElement
let cancel: (taskId: string) => Promise<unknown>
const refresh = vi.fn(async () => {})
const sendMessage = vi.fn()

function OptionsView() {
  cancel = useOptionsDownloadActions(refresh).cancelTask
  return createElement(Toaster)
}

function SidepanelView() {
  cancel = useCommandCenterActions().handleCancelTask
  return createElement(Toaster)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-30T12:00:00Z"))
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const stored: Record<string, unknown> = {}
  vi.stubGlobal("chrome", {
    ...chrome,
    runtime: { sendMessage },
    storage: {
      session: {
        get: async (key: string) =>
          Object.hasOwn(stored, key) ? { [key]: stored[key] } : {},
        set: async (values: Record<string, unknown>) =>
          Object.assign(stored, values),
        remove: async (key: string) => {
          delete stored[key]
        },
      },
    },
  })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  toast.dismiss()
  container.remove()
  vi.clearAllTimers()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

async function mountSurface(surface: "options" | "sidepanel") {
  await act(async () =>
    root.render(
      createElement(surface === "options" ? OptionsView : SidepanelView)
    )
  )
}

async function showQueuedReceipt(surface: "options" | "sidepanel") {
  const receipt = {
    token: `${surface}-queued-token`,
    type: "cancel_queued" as const,
    expiresAt: Date.now() + 5_000,
  }
  const response = Promise.withResolvers<unknown>()
  sendMessage.mockImplementation((message: RuntimeMessage) => {
    if (message.type === "CANCEL_TASK") return response.promise
    expect(message.type).toBe("UNDO_QUEUE_ACTION")
    if (message.type === "UNDO_QUEUE_ACTION") {
      expect(message.payload.token).toBe(receipt.token)
      return { success: Date.now() < receipt.expiresAt }
    }
  })
  let pending!: Promise<unknown>
  await act(async () => {
    pending = cancel("queued-task")
  })
  await act(async () => vi.advanceTimersByTimeAsync(1_500))
  await act(async () => {
    response.resolve({ success: true, data: { undo: receipt } })
    await pending
  })
  await act(async () => vi.advanceTimersByTimeAsync(0))
  return receipt
}

function findUndo() {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === t("common_undo")
  )
}

it.each(["options", "sidepanel"] as const)(
  "keeps %s Undo usable while the receipt is live and returns its task-bound token",
  async (surface) => {
    await mountSurface(surface)
    const receipt = await showQueuedReceipt(surface)
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    const undo = findUndo()
    expect(undo).toBeDefined()
    await act(async () => undo!.click())
    expect(sendMessage.mock.calls.map(([message]) => message)).toEqual([
      expect.objectContaining({
        type: "CANCEL_TASK",
        payload: { taskId: "queued-task" },
      }),
      expect.objectContaining({
        type: "UNDO_QUEUE_ACTION",
        payload: { token: receipt.token },
      }),
    ])
  }
)

it.each(["options", "sidepanel"] as const)(
  "removes %s Undo once the receipt expires",
  async (surface) => {
    await mountSurface(surface)
    const receipt = await showQueuedReceipt(surface)
    expect(findUndo()).toBeDefined()
    await act(async () =>
      vi.advanceTimersByTimeAsync(receipt.expiresAt - Date.now() + 1_000)
    )
    expect(findUndo()).toBeUndefined()
    expect(sendMessage.mock.calls.map(([message]) => message.type)).toEqual([
      "CANCEL_TASK",
    ])
  }
)

// @vitest-environment happy-dom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QueueUndoProvider } from "@/entrypoints/sidepanel/components/QueueUndo"
import { PanelFeedbackProvider } from "@/entrypoints/sidepanel/components/PanelFeedback"
import { PanelFeedbackRegion } from "@/entrypoints/sidepanel/components/PanelFeedbackRegion"
import { useCommandCenterActions } from "@/entrypoints/sidepanel/hooks/useCommandCenterActions"
import { t } from "@/src/runtime/i18n"

function clickUndo() {
  const button = document.querySelector<HTMLButtonElement>(".queue-undo button")
  if (!button) throw new Error("Expected the panel Undo control")
  act(() => button.click())
}

describe("mounted queue commands", () => {
  let root: Root
  let container: HTMLDivElement
  let actions: ReturnType<typeof useCommandCenterActions>
  const sendMessage = vi.fn()
  const stored: Record<string, unknown> = {}

  function View() {
    actions = useCommandCenterActions()
    return createElement(PanelFeedbackRegion)
  }
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("chrome", {
      ...chrome,
      runtime: { sendMessage },
      storage: {
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
        session: {
          get: async (key: string) =>
            Object.hasOwn(stored, key) ? { [key]: stored[key] } : {},
          set: async (items: Record<string, unknown>) =>
            Object.assign(stored, items),
          remove: async (key: string) => {
            delete stored[key]
          },
        },
      },
    })
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    sendMessage.mockResolvedValue({ success: true, data: [] })
    await act(async () =>
      root.render(
        createElement(
          PanelFeedbackProvider,
          null,
          createElement(QueueUndoProvider, { children: createElement(View) })
        )
      )
    )
    sendMessage.mockReset()
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    Object.keys(stored).forEach((key) => delete stored[key])
    vi.resetAllMocks()
    vi.unstubAllGlobals()
  })

  it("suppresses a repeated cancel, releases pending state, and offers the background Undo receipt", async () => {
    const response = Promise.withResolvers<unknown>()
    sendMessage.mockImplementation((message) =>
      message.type === "CANCEL_TASK"
        ? response.promise
        : message.type === "RENEW_QUEUE_UNDO"
          ? {
              success: true,
              undo: {
                token: message.payload.token,
                type: "cancel_queued",
                expiresAt: Date.now() + 5000,
              },
            }
          : { success: true }
    )
    let pending!: ReturnType<typeof actions.handleCancelTask>
    await act(async () => {
      pending = actions.handleCancelTask("queued")
      expect(await actions.handleCancelTask("queued")).toEqual({
        kind: "already-pending",
      })
    })
    expect(actions.cancelingTaskIds.has("queued")).toBe(true)
    const undo = {
      token: "undo-token",
      type: "cancel_queued",
      expiresAt: Date.now() + 3000,
    }
    await act(async () => {
      response.resolve({ success: true, data: { undo } })
      expect(await pending).toEqual({ kind: "completed" })
    })
    expect(actions.cancelingTaskIds.size).toBe(0)
    clickUndo()
    await vi.waitFor(() =>
      expect(
        sendMessage.mock.calls.some(
          ([message]) => message.type === "UNDO_QUEUE_ACTION"
        )
      ).toBe(true)
    )
    expect(
      sendMessage.mock.calls.find(
        ([message]) => message.type === "UNDO_QUEUE_ACTION"
      )?.[0]
    ).toMatchObject({
      type: "UNDO_QUEUE_ACTION",
      payload: { token: "undo-token" },
    })
  })

  it("returns cancellation failure for inline confirmation and permits retry", async () => {
    sendMessage
      .mockResolvedValueOnce({ success: false, error: "cancel failed" })
      .mockResolvedValue({ success: true })
    await act(async () =>
      expect(await actions.handleCancelTask("active")).toMatchObject({
        kind: "failed",
      })
    )
    expect(actions.cancelingTaskIds.size).toBe(0)
    await act(async () =>
      expect(await actions.handleCancelTask("active")).toEqual({
        kind: "completed",
      })
    )
    expect(actions.taskActionErrors).toEqual({})
    expect(container.textContent).not.toContain(
      t("sidepanel_toastCancelFailed")
    )
  })

  it("offers history removal Undo and reports a rejected Undo without retaining task ownership", async () => {
    const undo = {
      token: "history-undo",
      type: "remove_history",
      expiresAt: Date.now() + 3000,
    }
    sendMessage.mockImplementation((message) =>
      message.type === "REMOVE_TASK"
        ? { success: true, data: { undo } }
        : message.type === "RENEW_QUEUE_UNDO"
          ? { success: true, undo }
          : { success: false, error: "expired" }
    )
    await act(async () => actions.handleRemoveTask("history-task"))
    expect(actions.removingTaskIds.size).toBe(0)
    clickUndo()
    await vi.waitFor(() =>
      expect(container.textContent).toContain(t("sidepanel_undoFailed"))
    )
    expect(
      sendMessage.mock.calls.find(
        ([message]) => message.type === "UNDO_QUEUE_ACTION"
      )?.[0]
    ).toMatchObject({
      type: "UNDO_QUEUE_ACTION",
      payload: { token: "history-undo" },
    })
  })

  it("opens settings and full history through their background-owned targets", async () => {
    sendMessage.mockResolvedValue({ success: true })
    await act(async () => {
      await actions.openSettings()
      await actions.openFullHistory()
    })
    expect(sendMessage.mock.calls.map(([message]) => message)).toEqual([
      { target: "background", type: "OPEN_OPTIONS", payload: {} },
      {
        target: "background",
        type: "OPEN_OPTIONS",
        payload: { page: "activity" },
      },
    ])
  })

  it.each([
    ["openSettings", "sidepanel_settingsOpenFailed"],
    ["openFullHistory", "sidepanel_historyOpenFailed"],
  ] as const)("shows panel feedback when %s fails", async (action, key) => {
    sendMessage.mockResolvedValue({ success: false, error: "tab unavailable" })
    await act(async () => actions[action]())
    expect(container.textContent).toContain(t(key))
  })

  it("tracks different tasks and command kinds independently while requests overlap", async () => {
    const response = Promise.withResolvers<unknown>()
    sendMessage.mockReturnValue(response.promise)
    let pending!: Promise<unknown>[]
    await act(async () => {
      pending = [
        actions.handleRetryFailed("first"),
        actions.handleRetryFailed("second"),
        actions.handleRestartTask("first"),
      ]
    })
    expect([...actions.retryingTaskIds]).toEqual(["first", "second"])
    expect([...actions.restartingTaskIds]).toEqual(["first"])
    await act(async () => {
      response.resolve({ success: true })
      await Promise.all(pending)
    })
    expect(actions.retryingTaskIds.size).toBe(0)
    expect(actions.restartingTaskIds.size).toBe(0)
    expect(sendMessage).toHaveBeenCalledTimes(3)
  })

  it.each(["retry", "restart", "remove", "move"] as const)(
    "releases %s ownership after failure and accepts a fresh attempt",
    async (kind) => {
      const operations = {
        retry: () => actions.handleRetryFailed("task"),
        restart: () => actions.handleRestartTask("task"),
        remove: () => actions.handleRemoveTask("task"),
        move: () => actions.handleMoveTaskToTop("task"),
      }
      const pendingSets = () => ({
        retry: actions.retryingTaskIds,
        restart: actions.restartingTaskIds,
        remove: actions.removingTaskIds,
        move: actions.movingTaskIds,
      })
      const errorKeys = {
        retry: "sidepanel_toastRetryFailed",
        restart: "sidepanel_toastRestartFailed",
        remove: "sidepanel_toastRemoveFailed",
        move: "sidepanel_toastMoveTopFailed",
      }
      const response = Promise.withResolvers<unknown>()
      sendMessage
        .mockReturnValueOnce(response.promise)
        .mockResolvedValue({ success: true })
      let pending!: Promise<void>
      await act(async () => {
        pending = operations[kind]()
        await operations[kind]()
      })
      expect(pendingSets()[kind].has("task")).toBe(true)
      await act(async () => {
        response.resolve({ success: false, error: "command failed" })
        await pending
      })
      expect(pendingSets()[kind].size).toBe(0)
      expect(actions.taskActionErrors).toEqual({ task: t(errorKeys[kind]) })
      expect(container.textContent).not.toContain(t(errorKeys[kind]))
      const requestTypes = {
        retry: "RETRY_FAILED_CHAPTERS",
        restart: "RESTART_TASK",
        remove: "REMOVE_TASK",
        move: "MOVE_TASK_TO_TOP",
      }
      expect(sendMessage.mock.calls[0][0]).toMatchObject({
        type: requestTypes[kind],
        payload: { taskId: "task" },
      })
      await act(async () => operations[kind]())
      expect(sendMessage).toHaveBeenCalledTimes(2)
      expect(actions.taskActionErrors).toEqual({})
    }
  )

  it("does not let an earlier action error replace the newer action on the same task", async () => {
    const retry = Promise.withResolvers<unknown>()
    sendMessage
      .mockReturnValueOnce(retry.promise)
      .mockResolvedValueOnce({ success: true })
    let earlier!: Promise<void>
    await act(async () => {
      earlier = actions.handleRetryFailed("task")
      await actions.handleRestartTask("task")
      retry.resolve({ success: false, error: "older operation failed" })
      await earlier
    })
    expect(actions.taskActionErrors).toEqual({})
  })
})

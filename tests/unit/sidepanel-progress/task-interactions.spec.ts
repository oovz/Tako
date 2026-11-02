// @vitest-environment happy-dom

import { act, createElement, type ComponentProps, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { webcrypto } from "node:crypto"

import { TooltipProvider } from "@/components/ui/tooltip"
import { CommandCenterQueue } from "@/entrypoints/sidepanel/components/CommandCenterQueue"
import { CommandCenterTaskActions } from "@/entrypoints/sidepanel/components/CommandCenterTaskActions"
import type { QueueTaskSummary } from "@/src/domain/queue/state"
import { useCommandCenterActions } from "@/entrypoints/sidepanel/hooks/useCommandCenterActions"
import { t } from "@/src/runtime/i18n"

const toastError = vi.hoisted(() => vi.fn())
vi.mock("sonner", () => ({ toast: { error: toastError } }))

function task(
  id: string,
  status: QueueTaskSummary["status"]
): QueueTaskSummary {
  return {
    id,
    seriesKey: `mangadex#${id}`,
    seriesTitle: `Series ${id}`,
    siteIntegration: "mangadex",
    destination: { kind: "downloads-api" },
    status,
    chapters: { total: 2, completed: 1, unsuccessful: 1 },
    timestamps: { created: 1 },
  }
}

describe("task actions through mounted components", () => {
  let root: Root
  let container: HTMLDivElement
  const sendMessage = vi.fn()
  const session: Record<string, unknown> = {}

  function RecoveryQueue({ tasks }: { tasks: QueueTaskSummary[] }) {
    const commands = useCommandCenterActions()
    return createElement(
      "div",
      null,
      tasks.map((item) =>
        createElement(
          "section",
          { key: item.id, "aria-label": item.seriesTitle },
          createElement(CommandCenterQueue, {
            tasks: [item],
            retryingTaskIds: commands.retryingTaskIds,
            restartingTaskIds: commands.restartingTaskIds,
            removingTaskIds: commands.removingTaskIds,
            onRetryFailed: commands.handleRetryFailed,
            onRestartTask: commands.handleRestartTask,
            onRemoveTask: commands.handleRemoveTask,
          })
        )
      )
    )
  }

  function recoveryControl(id: string, label: string) {
    const section = container.querySelector(
      `section[aria-label="Series ${id}"]`
    )!
    return Array.from(
      section.querySelectorAll<HTMLButtonElement>("button")
    ).find((button) => button.getAttribute("aria-label") === label)
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("crypto", webcrypto)
    sendMessage.mockResolvedValue({ success: true })
    vi.stubGlobal("chrome", {
      ...chrome,
      runtime: { getURL: (path: string) => path, sendMessage },
      storage: {
        session: {
          get: async (key: string) =>
            Object.hasOwn(session, key) ? { [key]: session[key] } : {},
          set: async (value: Record<string, unknown>) =>
            Object.assign(session, value),
          remove: async (key: string) => {
            delete session[key]
          },
        },
      },
    })
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    for (const key of Object.keys(session)) delete session[key]
  })

  async function render(element: ReactNode) {
    await act(async () =>
      root.render(createElement(TooltipProvider, null, element))
    )
  }

  function button(label: string) {
    const result = Array.from(document.querySelectorAll("button")).find(
      (element) =>
        element.getAttribute("aria-label") === label ||
        element.textContent === label
    )
    expect(result, label).toBeDefined()
    return result!
  }

  async function click(label: string) {
    await act(async () => button(label).click())
  }

  it("routes queued controls to their task and blocks only the pending action", async () => {
    const onMoveTaskToTop = vi.fn()
    const onBeginCancel = vi.fn()
    const props: ComponentProps<typeof CommandCenterTaskActions> = {
      taskId: "queued",
      status: "queued",
      isCanceling: false,
      isMoving: true,
      canCancel: true,
      canRetryFailed: false,
      canRestart: false,
      canMoveToTop: true,
      canRemove: false,
      onBeginCancel,
      onMoveTaskToTop,
    }
    await render(createElement(CommandCenterTaskActions, props))
    await click("Move task to top")
    await click("Cancel download")
    expect(onMoveTaskToTop).not.toHaveBeenCalled()
    expect(onBeginCancel).toHaveBeenCalledWith("queued")
    await render(
      createElement(CommandCenterTaskActions, { ...props, isMoving: false })
    )
    await click("Move task to top")
    expect(onMoveTaskToTop).toHaveBeenCalledWith("queued")
  })

  it("keeps retry primary and dispatches uncertain restart from the overflow menu", async () => {
    const onRetryFailed = vi.fn()
    const onRestartTask = vi.fn()
    const onRemoveTask = vi.fn()
    const props: ComponentProps<typeof CommandCenterTaskActions> = {
      taskId: "partial",
      status: "partial_success",
      outputUncertain: true,
      isCanceling: false,
      isRestarting: true,
      canCancel: false,
      canRetryFailed: true,
      canRestart: true,
      canMoveToTop: false,
      canRemove: true,
      onBeginCancel: vi.fn(),
      onRetryFailed,
      onRestartTask,
      onRemoveTask,
    }
    await render(createElement(CommandCenterTaskActions, props))
    await click("Retry failed chapters (may create duplicates)")
    await click("Remove")
    expect(onRetryFailed).toHaveBeenCalledWith("partial")
    expect(onRemoveTask).toHaveBeenCalledWith("partial")
    await act(async () =>
      button("More actions").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      )
    )
    const restart = document.querySelector('[role="menuitem"]')
    expect(restart?.textContent).toBe(
      "Retry all chapters (may create duplicates)"
    )
    expect(restart?.getAttribute("aria-disabled")).toBe("true")
    await act(async () =>
      restart?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    )
    expect(onRestartTask).not.toHaveBeenCalled()
    await render(
      createElement(CommandCenterTaskActions, { ...props, isRestarting: false })
    )
    expect(restart?.getAttribute("aria-disabled")).toBeNull()
    await act(async () =>
      restart?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    )
    expect(onRestartTask).toHaveBeenCalledWith("partial")
  })

  it("reports queued cancellation failure without opening confirmation", async () => {
    const onCancelTask = vi.fn(async () => ({
      kind: "failed" as const,
      message: "Try again",
    }))
    await render(
      createElement(CommandCenterQueue, {
        tasks: [task("queued", "queued")],
        onCancelTask,
      })
    )
    await click("Cancel download")
    expect(onCancelTask).toHaveBeenCalledWith("queued")
    expect(toastError).toHaveBeenCalledWith("Try again")
    expect(container.querySelector('[role="group"]')).toBeNull()
  })

  it("retains active confirmation after failure or pending, then dismisses after success", async () => {
    const onCancelTask = vi
      .fn()
      .mockResolvedValueOnce({ kind: "failed", message: "Try again" })
      .mockResolvedValueOnce({ kind: "already-pending" })
      .mockResolvedValueOnce({ kind: "completed" })
    await render(
      createElement(CommandCenterQueue, {
        tasks: [task("active", "downloading")],
        onCancelTask,
      })
    )
    await click("Cancel download")
    expect(onCancelTask).not.toHaveBeenCalled()
    const confirmLabel = button("Yes").textContent!
    await click(confirmLabel)
    expect(container.textContent).toContain("Try again")
    await click(confirmLabel)
    expect(container.querySelector('[role="group"]')).not.toBeNull()
    await click(confirmLabel)
    expect(container.querySelector('[role="group"]')).toBeNull()
    expect(onCancelTask).toHaveBeenCalledTimes(3)
    await click("Cancel download")
    expect(container.textContent).not.toContain("Try again")
    await click("No")
    expect(container.querySelector('[role="group"]')).toBeNull()
  })

  it.each(["retry", "restart", "remove"] as const)(
    "isolates pending %s controls by task while other recovery remains usable",
    async (action) => {
      const command = {
        retry: "RETRY_FAILED_CHAPTERS",
        restart: "RESTART_TASK",
        remove: "REMOVE_TASK",
      }[action]
      const label = {
        retry: t("sidepanel_retryFailedChapters"),
        restart: t("sidepanel_restartAllChapters"),
        remove: t("common_remove"),
      }[action]
      const status = action === "retry" ? "partial_success" : "failed"
      const tasks = ["first", "second"].map((id) => ({
        ...task(id, status),
        chapters:
          status === "failed"
            ? { total: 2, completed: 0, unsuccessful: 2 }
            : { total: 2, completed: 1, unsuccessful: 1 },
        timestamps: { created: 1, completed: 2 },
      }))
      const response = Promise.withResolvers<unknown>()
      sendMessage.mockImplementation(
        (message: { type: string; payload: { taskId: string } }) =>
          message.type === command && message.payload.taskId === "first"
            ? response.promise
            : Promise.resolve({ success: true })
      )
      await render(createElement(RecoveryQueue, { tasks }))
      const first = recoveryControl("first", label)!
      const second = recoveryControl("second", label)!
      expect(first.disabled).toBe(false)
      expect(second.disabled).toBe(false)
      await act(async () => first.click())
      try {
        await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
        expect(first.disabled).toBe(true)
        await vi.waitFor(() => expect(second.disabled).toBe(false))
        if (action !== "remove")
          expect(recoveryControl("first", t("common_remove"))!.disabled).toBe(
            false
          )
        await act(async () => first.click())
        expect(sendMessage).toHaveBeenCalledOnce()
        await act(async () => second.click())
        await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2))
        expect(
          sendMessage.mock.calls.map(([message]) => [
            message.type,
            message.payload.taskId,
          ])
        ).toEqual([
          [command, "first"],
          [command, "second"],
        ])
        expect(first.disabled).toBe(true)
        expect(second.disabled).toBe(false)
      } finally {
        await act(async () => response.resolve({ success: true }))
      }
      await vi.waitFor(() => expect(first.disabled).toBe(false))
    }
  )

  it("keeps recovery unavailable for a missing captured folder while Remove stays usable", async () => {
    const unavailable: QueueTaskSummary = {
      ...task("missing", "failed"),
      chapters: { total: 2, completed: 0, unsuccessful: 2 },
      destination: { kind: "file-system-access", handleId: null },
      targetUnavailable: true,
      timestamps: { created: 1, completed: 2 },
    }
    await render(createElement(RecoveryQueue, { tasks: [unavailable] }))
    expect(
      recoveryControl("missing", t("sidepanel_restartAllChapters"))
    ).toBeUndefined()
    const remove = recoveryControl("missing", t("common_remove"))!
    expect(remove.disabled).toBe(false)
    await act(async () => remove.click())
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "REMOVE_TASK",
        payload: { taskId: "missing" },
      })
    )
  })

  it("keeps a retried terminal task removable without recovery or active progress", async () => {
    const original = {
      ...task("retried", "partial_success"),
      isRetried: true,
      timestamps: { created: 1, completed: 2 },
    }
    await render(createElement(RecoveryQueue, { tasks: [original] }))
    expect(
      recoveryControl("retried", t("sidepanel_retryFailedChapters"))
    ).toBeUndefined()
    expect(
      recoveryControl("retried", t("sidepanel_restartAllChapters"))
    ).toBeUndefined()
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.querySelector('[role="progressbar"]')).toBeNull()
    const remove = recoveryControl("retried", t("common_remove"))!
    expect(remove.disabled).toBe(false)
    await act(async () => remove.click())
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "REMOVE_TASK",
        payload: { taskId: "retried" },
      })
    )
  })
})

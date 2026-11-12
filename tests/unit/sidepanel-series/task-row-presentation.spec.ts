// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { CommandCenterTaskRow } from "@/entrypoints/sidepanel/components/CommandCenterTaskRow"
import { CommandCenterQueue } from "@/entrypoints/sidepanel/components/CommandCenterQueue"
import type { QueueTaskSummary } from "@/src/domain/queue/state"
import type { CancelTaskResult } from "@/entrypoints/sidepanel/types"
import { t } from "@/src/runtime/i18n"

type RowProps = ComponentProps<typeof CommandCenterTaskRow>

function task(overrides: Partial<QueueTaskSummary> = {}): QueueTaskSummary {
  return {
    id: "task-one",
    seriesKey: "mangadex#one",
    seriesTitle: "Series One",
    siteIntegration: "mangadex",
    destination: { kind: "downloads-api" },
    status: "partial_success",
    chapters: { total: 4, completed: 2, unsuccessful: 2 },
    timestamps: { created: 1 },
    ...overrides,
  }
}

function rowProps(overrides: Partial<RowProps> = {}): RowProps {
  return {
    task: task(),
    isCanceling: false,
    isRetrying: false,
    isRestarting: false,
    isRemoving: false,
    isMoving: false,
    isConfirmingCancel: false,
    cancelError: null,
    activeTaskProgress: null,
    showActiveProgress: false,
    onBeginCancel: vi.fn(),
    onConfirmCancel: vi.fn(),
    onDismissCancel: vi.fn(),
    onRetryFailed: vi.fn(async () => {}),
    onRestartTask: vi.fn(async () => {}),
    onRemoveTask: vi.fn(async () => {}),
    ...overrides,
  }
}

describe("task row content and controls", () => {
  let root: Root
  let container: HTMLDivElement
  const sendMessage = vi.fn()
  const createTab = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("chrome", {
      ...chrome,
      storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
      runtime: { getURL: (path: string) => path, sendMessage },
      tabs: { create: createTab },
    })
    sendMessage.mockImplementation(async (request: { type: string }) =>
      request.type === "GET_COVER_PREVIEW"
        ? { success: false, error: "Unavailable" }
        : { success: true }
    )
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    window.dispatchEvent(new Event("pagehide"))
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  async function render(props = rowProps()) {
    await act(async () =>
      root.render(
        createElement(
          TooltipProvider,
          null,
          createElement(CommandCenterTaskRow, props)
        )
      )
    )
  }

  function button(label: string): HTMLButtonElement {
    const control = Array.from(container.querySelectorAll("button")).find(
      (element) =>
        element.getAttribute("aria-label") === label ||
        element.textContent === label
    )
    if (!control) throw new Error(`Missing button: ${label}`)
    return control
  }

  async function openRecoveryPanel() {
    const trigger = container.querySelector<HTMLButtonElement>(
      "[data-task-feedback-trigger]"
    )
    if (!trigger) throw new Error("Missing task feedback trigger")
    const panel = document.getElementById(
      trigger.getAttribute("aria-controls") ?? ""
    )
    if (
      !panel?.matches("[data-task-feedback-panel]") ||
      !trigger.closest("[data-task-id]")?.contains(panel)
    ) {
      throw new Error("Missing inline task feedback panel")
    }
    if (trigger.getAttribute("aria-expanded") === "false") {
      await act(async () => trigger.click())
    }
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    expect(panel.closest("[inert]")).toBeNull()
    return panel
  }

  function recoveryButton(panel: HTMLElement, label: string) {
    return Array.from(panel.querySelectorAll("button")).find(
      (control) =>
        (control.getAttribute("aria-label") ?? control.textContent) === label
    )
  }

  it("shows confirmation as a focus boundary and restores the same row action after Escape", async () => {
    const onCancelTask = vi.fn<(taskId: string) => Promise<CancelTaskResult>>(
      async () => ({ kind: "completed" })
    )
    const queue = (cancelingTaskIds = new Set<string>()) =>
      createElement(
        TooltipProvider,
        null,
        createElement(CommandCenterQueue, {
          tasks: [task({ status: "downloading" })],
          onCancelTask,
          cancelingTaskIds,
        })
      )
    await act(async () => root.render(queue()))
    const trigger = button(t("sidepanel_cancelDownload"))
    trigger.focus()
    await act(async () => trigger.click())
    expect(onCancelTask).not.toHaveBeenCalled()
    const cancel = button(t("sidepanel_keepDownloading"))
    expect(document.activeElement).toBe(cancel)
    await act(async () =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    )
    expect(
      container.querySelector('[data-open="true"] [role="group"]')
    ).toBeNull()
    expect(document.activeElement).toBe(trigger)
    await act(async () => trigger.click())
    await act(async () => root.render(queue(new Set(["task-one"]))))
    expect(button(t("sidepanel_keepDownloading")).disabled).toBe(true)
    expect(
      container
        .querySelector('[data-open="true"] [role="group"]')
        ?.getAttribute("aria-busy")
    ).toBe("true")
    await act(async () =>
      container
        .querySelector('[data-open="true"] [role="group"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
        )
    )
    expect(
      container.querySelector('[data-open="true"] [role="group"]')
    ).not.toBeNull()
    expect(onCancelTask).not.toHaveBeenCalled()
  })

  it("keeps retry and remove task identities separate while only the retry action is pending", async () => {
    const onRetryFailed = vi.fn(async (_taskId: string) => {})
    const onRemoveTask = vi.fn(async (_taskId: string) => {})
    const props = rowProps({ isRetrying: true, onRetryFailed, onRemoveTask })
    await render(props)
    const panel = await openRecoveryPanel()
    const retry = recoveryButton(panel, t("sidepanel_retryRemaining"))!
    const dismiss = recoveryButton(panel, t("common_dismiss"))!
    expect(retry.disabled).toBe(true)
    expect(dismiss.disabled).toBe(false)
    await act(async () => retry.click())
    await act(async () => dismiss.click())
    expect(onRetryFailed).not.toHaveBeenCalled()
    expect(onRemoveTask).toHaveBeenCalledWith("task-one")
    await render({ ...props, isRetrying: false })
    const readyPanel = await openRecoveryPanel()
    await act(async () =>
      recoveryButton(readyPanel, t("sidepanel_retryRemaining"))!.click()
    )
    expect(onRetryFailed).toHaveBeenCalledWith("task-one")
  })

  it("keeps folder recovery available while an unavailable captured destination blocks retry and restart", async () => {
    const captured = task({
      destination: { kind: "file-system-access", handleId: "folder-one" },
      requestedPath: "My series/Volume 1",
      targetUnavailable: true,
      folderAccessRequired: true,
      failureCategory: "provider_changed",
    })
    await render(rowProps({ task: captured }))
    expect(container.querySelector(".task-heading > h3")?.textContent).toBe(
      "Series One"
    )
    expect(
      button("Series One · Chapter results").getAttribute("aria-expanded")
    ).toBe("false")
    expect(container.textContent).toContain("MangaDex")
    const panel = await openRecoveryPanel()
    expect(panel.textContent).toContain("2/4")
    expect(panel.textContent).toContain(t("taskFolder_originalUnavailable"))
    expect(panel.textContent).toContain(t("downloadError_providerChanged"))
    expect(
      panel.querySelector("[data-task-destination]")?.textContent
    ).toContain("My series/Volume 1")
    expect(recoveryButton(panel, t("sidepanel_retryRemaining"))).toBeUndefined()
    expect(recoveryButton(panel, t("sidepanel_restartTask"))).toBeUndefined()
    await act(async () =>
      recoveryButton(panel, t("taskFolder_openActions"))!.click()
    )
    expect(sendMessage).toHaveBeenCalledWith({
      target: "background",
      type: "OPEN_OPTIONS",
      payload: { page: "activity", taskId: "task-one" },
    })
    await render(
      rowProps({ task: { ...captured, folderAccessRequired: undefined } })
    )
    const withoutFolderAccess = await openRecoveryPanel()
    expect(
      recoveryButton(withoutFolderAccess, t("taskFolder_openActions"))
    ).toBeUndefined()
  })

  it("puts output verification first and confirms a retry chosen from feedback", async () => {
    const onRetryFailed = vi.fn(async (_taskId: string) => {})
    await render(
      rowProps({
        task: task({
          outputUncertain: true,
          failureCategory: "browser_output_unconfirmed",
        }),
        onRetryFailed,
      })
    )
    const panel = await openRecoveryPanel()
    expect(panel.querySelector("button")?.textContent).toBe(
      t("sidepanel_checkDownloads")
    )
    expect(panel.textContent).toContain(
      t("downloadError_browserOutputUnconfirmed")
    )
    const retry = recoveryButton(panel, t("sidepanel_retryUncertainHandoff"))!
    expect(retry).toBeTruthy()
    await act(async () => retry.click())
    expect(onRetryFailed).not.toHaveBeenCalled()
    expect(container.textContent).toContain(t("sidepanel_duplicateWarning"))
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(button(t("common_cancel")))
    )
    await act(async () => button(t("sidepanel_retryAnyway")).click())
    expect(onRetryFailed).toHaveBeenCalledWith("task-one")
  })

  it.each([
    ["taskFolder_openActions", "taskFolder_openActionsFailed"],
    ["sidepanel_checkDownloads", "sidepanel_checkDownloadsFailed"],
  ] as const)(
    "reports a rejected %s action in the row and clears it on retry",
    async (label, failureKey) => {
      if (label === "taskFolder_openActions") {
        sendMessage.mockResolvedValueOnce({ success: false, error: "blocked" })
      } else {
        createTab
          .mockRejectedValueOnce(new Error("blocked"))
          .mockResolvedValueOnce({})
      }
      await render(
        rowProps({
          task: task({
            folderAccessRequired:
              label === "taskFolder_openActions" ? true : undefined,
            outputUncertain: label === "sidepanel_checkDownloads",
          }),
        })
      )
      const panel = await openRecoveryPanel()
      await act(async () => recoveryButton(panel, t(label))!.click())
      expect(
        container.querySelector("[data-task-feedback-summary]")?.textContent
      ).toBe(t(failureKey))
      expect(
        container
          .querySelector("[data-task-feedback-trigger]")
          ?.getAttribute("aria-label")
      ).toBe(t(failureKey))
      const retryPanel = await openRecoveryPanel()
      await act(async () => recoveryButton(retryPanel, t(label))!.click())
      expect(
        container.querySelector(
          '[data-task-id="task-one"] [aria-live="assertive"]'
        )?.textContent
      ).toBe("")
      expect(
        container.querySelector("[data-task-feedback-summary]")?.textContent
      ).toBe(t("status_partialSuccess"))
    }
  )

  it("uses task authorization for its cover request", async () => {
    await render(
      rowProps({
        task: task({
          status: "downloading",
          coverUrl: "https://uploads.mangadex.org/cover.jpg",
        }),
      })
    )
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "GET_COVER_PREVIEW",
        payload: expect.objectContaining({
          source: { kind: "task", taskId: "task-one" },
        }),
      })
    )
  })

  it.each([
    {
      outputDestination: undefined,
      saveConfirmedAt: undefined,
      label: "status_processed",
      unconfirmed: true,
    },
    {
      outputDestination: "downloads-api" as const,
      saveConfirmedAt: 42,
      label: "status_saved",
      unconfirmed: false,
    },
    {
      outputDestination: "fsa" as const,
      saveConfirmedAt: 42,
      label: "status_savedToFolder",
      unconfirmed: false,
    },
  ])(
    "keeps the known completed output evidence in its status: $label",
    async ({ outputDestination, saveConfirmedAt, label, unconfirmed }) => {
      await render(
        rowProps({
          task: task({
            status: "completed",
            outputDestination,
            saveConfirmedAt,
          }),
        })
      )
      expect(
        container.querySelector("[data-task-feedback-summary]")?.textContent
      ).toBe(t(label))
      const panel = await openRecoveryPanel()
      expect(
        panel.textContent?.includes(t("output_saveUnconfirmedDescription"))
      ).toBe(unconfirmed)
    }
  )
})

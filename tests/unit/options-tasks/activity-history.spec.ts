// @vitest-environment happy-dom
import { act, createElement, useEffect, useMemo } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import {
  ActivityTab,
  type ActivityTabProps,
} from "@/entrypoints/options/tabs/ActivityTab"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { t } from "@/src/runtime/i18n"
import { useOptionsHistory } from "@/entrypoints/options/hooks/useOptionsHistory"
import {
  OptionsHistoryController,
  type OptionsHistoryScope,
} from "@/entrypoints/options/controllers/options-history-controller"
import type {
  OptionsConfigurationData,
  RuntimeMessage,
  RuntimeMessageResponse,
} from "@/src/runtime/runtime-message-contracts"

let root: Root
let container: HTMLDivElement
const sendMessage = vi.fn()
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("chrome", {
    ...chrome,
    runtime: { sendMessage, getURL: (path: string) => path },
    storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
  })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  sendMessage.mockReset()
  sendMessage.mockImplementation(async ({ type }) =>
    type === "GET_OPTIONS_DOWNLOAD_STATE"
      ? {
          success: true,
          data: {
            tasks: [
              {
                id: "completed",
                status: "completed",
                siteIntegrationId: "mangadex",
                mangaId: "series",
                seriesTitle: "Finished series",
                chapters: [],
                created: 1,
                completed: 2,
                settingsSnapshot: createTaskSettingsSnapshot(
                  DEFAULT_SETTINGS,
                  "mangadex"
                ),
              },
            ],
            queueStorageBytes: 1024,
          },
        }
      : { success: true }
  )
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  window.history.replaceState(null, "", window.location.pathname)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function defaults(): ActivityTabProps {
  return {
    stats: { totalChapters: 3, totalSeries: 2 },
    onClearChapterHistory: vi.fn(async () => true),
  }
}
async function mount(props: ActivityTabProps) {
  await act(async () => root.render(createElement(ActivityTab, props)))
}
function button(label: string, parent: ParentNode = document) {
  const found = [...parent.querySelectorAll("button")].find(
    (item) => item.textContent === label
  )
  expect(found, `button ${label}`).toBeDefined()
  return found!
}

it("focuses the linked download card after Activity loads", async () => {
  window.history.replaceState(null, "", "?tab=activity&task=completed")
  const reveal = vi.spyOn(HTMLElement.prototype, "scrollIntoView")

  await mount(defaults())

  const taskCard = container.querySelector(
    '.options-task-card[aria-label="Finished series"]'
  )
  expect(taskCard).toBeTruthy()
  expect(document.activeElement).toBe(taskCard)
  expect(reveal).toHaveBeenCalledWith({ block: "nearest" })
})

it("opens Activity normally if the linked download was removed", async () => {
  window.history.replaceState(null, "", "?tab=activity&task=removed")

  await mount(defaults())

  expect(container.textContent).toContain("Finished series")
  expect(document.activeElement).toBe(document.body)
})

it("routes chapter and task history confirmations to their own operations", async () => {
  const props = defaults()
  await mount(props)
  expect(container.textContent).toContain("1.0 KB")
  await act(async () =>
    button(t("options_clearChapterHistory"), container).click()
  )
  let dialog = document.querySelector('[role="alertdialog"]')!
  expect(props.onClearChapterHistory).not.toHaveBeenCalled()
  await act(async () =>
    button(t("options_clearChapterHistory"), dialog).click()
  )
  expect(props.onClearChapterHistory).toHaveBeenCalledOnce()
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  await act(async () =>
    button(t("options_clearTaskHistory"), container).click()
  )
  dialog = document.querySelector('[role="alertdialog"]')!
  await act(async () => button(t("options_clearTaskHistory"), dialog).click())
  expect(sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: "CLEAR_ALL_HISTORY" })
  )
  expect(props.onClearChapterHistory).toHaveBeenCalledOnce()
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
})

it("refreshes series choices and retains the selected provider identity after a failed clear", async () => {
  // happy-dom recursively dispatches focus between nested Radix portals.
  // This check exercises selection and clearing; browser tests own focus trapping.
  vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(() => {})
  const clear = vi.fn(async () => true).mockResolvedValueOnce(false)
  const refresh = vi.fn(async () => [
    {
      siteIntegrationId: "mangadex",
      seriesId: "same-id",
      seriesTitle: "One provider",
      chapterCount: 1,
    },
    {
      siteIntegrationId: "unknown-site",
      seriesId: "same-id",
      seriesTitle: "Other provider",
      chapterCount: 2,
    },
  ])
  await mount({
    ...defaults(),
    series: [],
    onRefreshSeries: refresh,
    onClearSeriesHistory: clear,
  })
  await act(async () =>
    button(t("options_clearSeriesHistory"), container).click()
  )
  expect(refresh).toHaveBeenCalledOnce()
  let dialog = document.querySelector('[role="dialog"]')!
  expect(button(t("options_clearSelected"), dialog).disabled).toBe(true)
  await act(async () =>
    dialog.querySelector<HTMLButtonElement>("#series-select")!.click()
  )
  const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
  expect(options.map((item) => item.textContent)).toEqual([
    "One provider (MangaDex)",
    "Other provider (unknown-site)",
  ])
  await act(async () => options[1].click())
  await act(async () => button(t("options_clearSelected"), dialog).click())
  expect(clear).toHaveBeenCalledExactlyOnceWith("unknown-site", "same-id")
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(button(t("options_clearSelected"), dialog).disabled).toBe(false)
  await act(async () => button(t("options_clearSelected"), dialog).click())
  expect(clear).toHaveBeenCalledTimes(2)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async () =>
    button(t("options_clearSeriesHistory"), container).click()
  )
  dialog = document.querySelector('[role="dialog"]')!
  expect(button(t("options_clearSelected"), dialog).disabled).toBe(true)
  await act(async () => button(t("common_cancel"), dialog).click())
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

type HistoryClearResponse =
  RuntimeMessageResponse<"CLEAR_PERSISTED_DOWNLOAD_HISTORY">

function HistoryWorkspace() {
  const controller = useMemo(() => new OptionsHistoryController(), [])
  const history = useOptionsHistory(controller)
  useEffect(() => {
    void history.handleRefreshHistory()
  }, [history.handleRefreshHistory])
  return createElement(ActivityTab, {
    stats: history.historyStats,
    series: history.historySeries,
    isClearingHistory: history.isClearing,
    onClearChapterHistory: history.clearChapterHistory,
    onClearSeriesHistory: history.clearSeriesHistory,
    onRefreshSeries: history.handleRefreshHistory,
  })
}

function configureHistoryRuntime(
  clear: (scope: OptionsHistoryScope) => Promise<HistoryClearResponse>
): OptionsConfigurationData {
  const projection: OptionsConfigurationData = {
    configuration: {
      settings: structuredClone(DEFAULT_SETTINGS),
      overrides: {},
      enablement: {},
      integrationSettings: {},
    },
    historyStats: { totalChapters: 1, totalSeries: 1 },
    historySeries: [
      {
        siteIntegrationId: "mangadex",
        seriesId: "only-series",
        seriesTitle: "Only saved series",
        chapterCount: 1,
      },
    ],
  }
  const normal = sendMessage.getMockImplementation()!
  sendMessage.mockImplementation((message: RuntimeMessage) => {
    if (message.type === "GET_OPTIONS_CONFIGURATION")
      return { success: true, data: projection }
    if (message.type === "CLEAR_PERSISTED_DOWNLOAD_HISTORY")
      return clear(message.payload)
    return normal(message)
  })
  return projection
}

function historyCommandTypes() {
  return sendMessage.mock.calls
    .map(([message]) => message.type)
    .filter((type) =>
      [
        "GET_OPTIONS_CONFIGURATION",
        "CLEAR_PERSISTED_DOWNLOAD_HISTORY",
      ].includes(type)
    )
}

it("retries a failed chapter-history clear while locking pending actions and clearing its failure alert", async () => {
  const retry = Promise.withResolvers<HistoryClearResponse>()
  const clear = vi
    .fn<(scope: OptionsHistoryScope) => Promise<HistoryClearResponse>>()
    .mockResolvedValueOnce({ success: false, error: "History unavailable" })
    .mockReturnValueOnce(retry.promise)
  const projection = configureHistoryRuntime(clear)
  await act(async () => root.render(createElement(HistoryWorkspace)))
  expect(button(t("options_clearChapterHistory"), container).disabled).toBe(
    false
  )
  expect(button(t("options_clearSeriesHistory"), container).disabled).toBe(
    false
  )
  await act(async () =>
    button(t("options_clearChapterHistory"), container).click()
  )
  let dialog = document.querySelector('[role="alertdialog"]')!
  expect(dialog.querySelector('[role="alert"]')).toBeNull()
  await act(async () =>
    button(t("options_clearChapterHistory"), dialog).click()
  )

  dialog = document.querySelector('[role="alertdialog"]')!
  expect(dialog).not.toBeNull()
  expect(dialog.querySelector('[role="alert"]')).not.toBeNull()
  expect(button(t("options_clearChapterHistory"), container).disabled).toBe(
    false
  )
  expect(clear).toHaveBeenCalledExactlyOnceWith({ scope: "all" })
  await act(async () =>
    button(t("options_clearChapterHistory"), dialog).click()
  )

  expect(dialog.querySelector('[role="alert"]')).toBeNull()
  expect(button(t("options_clearChapterHistory"), dialog).disabled).toBe(true)
  expect(button(t("options_clearChapterHistory"), container).disabled).toBe(
    true
  )
  expect(button(t("options_clearSeriesHistory"), container).disabled).toBe(true)
  await act(async () =>
    button(t("options_clearChapterHistory"), dialog).click()
  )
  expect(clear).toHaveBeenCalledTimes(2)
  projection.historyStats = { totalChapters: 0, totalSeries: 0 }
  projection.historySeries = []
  await act(async () => retry.resolve({ success: true }))

  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  expect(document.querySelector('[role="alert"]')).toBeNull()
  expect(button(t("options_clearChapterHistory"), container).disabled).toBe(
    true
  )
  expect(button(t("options_clearSeriesHistory"), container).disabled).toBe(true)
  expect(historyCommandTypes()).toEqual([
    "GET_OPTIONS_CONFIGURATION",
    "CLEAR_PERSISTED_DOWNLOAD_HISTORY",
    "CLEAR_PERSISTED_DOWNLOAD_HISTORY",
    "GET_OPTIONS_CONFIGURATION",
  ])
})

it("selects one saved series and keeps other history actions locked after closing its pending clear view", async () => {
  // Browser tests own nested Radix focus trapping; happy-dom recursively focuses portals.
  vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(() => {})
  const pending = Promise.withResolvers<HistoryClearResponse>()
  const clear = vi
    .fn<(scope: OptionsHistoryScope) => Promise<HistoryClearResponse>>()
    .mockReturnValue(pending.promise)
  const projection = configureHistoryRuntime(clear)
  await act(async () => root.render(createElement(HistoryWorkspace)))
  expect(button(t("options_clearSeriesHistory"), container).disabled).toBe(
    false
  )
  await act(async () =>
    button(t("options_clearSeriesHistory"), container).click()
  )
  const dialog = document.querySelector('[role="dialog"]')!
  await act(async () =>
    dialog.querySelector<HTMLButtonElement>("#series-select")!.click()
  )
  const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
  expect(options).toHaveLength(1)
  expect(options[0].getAttribute("aria-disabled")).not.toBe("true")
  await act(async () => options[0].click())
  expect(button(t("options_clearSelected"), dialog).disabled).toBe(false)
  await act(async () => button(t("options_clearSelected"), dialog).click())

  expect(clear).toHaveBeenCalledExactlyOnceWith({
    scope: "series",
    siteIntegrationId: "mangadex",
    seriesId: "only-series",
  })
  expect(button(t("options_clearSelected"), dialog).disabled).toBe(true)
  await act(async () => button(t("options_clearSelected"), dialog).click())
  expect(clear).toHaveBeenCalledOnce()
  await act(async () => button(t("common_cancel"), dialog).click())
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(button(t("options_clearChapterHistory"), container).disabled).toBe(
    true
  )
  expect(button(t("options_clearSeriesHistory"), container).disabled).toBe(true)
  projection.historyStats = { totalChapters: 0, totalSeries: 0 }
  projection.historySeries = []
  await act(async () => pending.resolve({ success: true }))

  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(clear).toHaveBeenCalledOnce()
  expect(historyCommandTypes()).toEqual([
    "GET_OPTIONS_CONFIGURATION",
    "GET_OPTIONS_CONFIGURATION",
    "CLEAR_PERSISTED_DOWNLOAD_HISTORY",
    "GET_OPTIONS_CONFIGURATION",
  ])
})

it("closes the series selector on Escape without waiting for another background refresh", async () => {
  const clear = vi
    .fn<(scope: OptionsHistoryScope) => Promise<HistoryClearResponse>>()
    .mockResolvedValue({ success: true })
  const projection = configureHistoryRuntime(clear)
  await act(async () => root.render(createElement(HistoryWorkspace)))
  await act(async () =>
    button(t("options_clearSeriesHistory"), container).click()
  )
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  const readsBeforeClose = historyCommandTypes().length
  const delayedRead = Promise.withResolvers<unknown>()
  const normal = sendMessage.getMockImplementation()!
  sendMessage.mockImplementation((message: RuntimeMessage) =>
    message.type === "GET_OPTIONS_CONFIGURATION"
      ? delayedRead.promise
      : normal(message)
  )
  try {
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        })
      )
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(historyCommandTypes()).toHaveLength(readsBeforeClose)
    expect(clear).not.toHaveBeenCalled()
  } finally {
    await act(async () =>
      delayedRead.resolve({ success: true, data: projection })
    )
  }
})

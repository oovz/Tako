// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import {
  ActivityTab,
  type ActivityTabProps,
} from "@/entrypoints/options/tabs/ActivityTab"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { t } from "@/src/runtime/i18n"

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

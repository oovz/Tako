// @vitest-environment happy-dom

import { webcrypto } from "node:crypto"
import { act, createElement, Fragment } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useDownload } from "@/entrypoints/sidepanel/hooks/useDownload"
import type { MangaPageState } from "@/src/types/tab-state"
import { t } from "@/src/runtime/i18n"
import {
  PanelFeedbackProvider,
  usePanelNotices,
} from "@/entrypoints/sidepanel/components/PanelFeedback"

const mangaState: MangaPageState = {
  sourceUrl: "https://mangadex.org/title/series",
  siteIntegrationId: "mangadex",
  mangaId: "series",
  seriesTitle: "Series",
  chapters: ["one", "two"].map((id, index) => ({
    id,
    url: `https://mangadex.org/chapter/${id}`,
    title: id,
    index,
    status: "queued",
    lastUpdated: 1,
  })),
  volumes: [],
  lastUpdated: 1,
}

describe("mounted enqueue lifetime", () => {
  let root: Root
  let container: HTMLDivElement
  let download: ReturnType<typeof useDownload>
  const sendMessage = vi.fn()
  const stored: Record<string, unknown> = {}

  function View({ revision = 3 }: { revision?: number | null }) {
    download = useDownload({
      windowId: 0,
      tabId: 0,
      mangaState,
      seriesRevision: revision ?? undefined,
    })
    return null
  }

  function FeedbackReadout() {
    const feedback = usePanelNotices()
    return createElement(
      "output",
      null,
      JSON.stringify({
        notices: feedback?.notices.map((notice) => t(notice.messageKey)),
      })
    )
  }

  function Harness({
    show = true,
    revision,
  }: {
    show?: boolean
    revision?: number | null
  }) {
    return createElement(PanelFeedbackProvider, {
      children: createElement(
        Fragment,
        null,
        show ? createElement(View, { revision }) : null,
        createElement(FeedbackReadout)
      ),
    })
  }
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("crypto", webcrypto)
    vi.stubGlobal("chrome", {
      ...chrome,
      runtime: { sendMessage },
      storage: {
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
    act(() => root.render(createElement(Harness)))
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    Object.keys(stored).forEach((key) => delete stored[key])
    vi.resetAllMocks()
    vi.unstubAllGlobals()
  })

  it("serializes enqueue clicks, sends the current selection identity, and reports acceptance once", async () => {
    const response = Promise.withResolvers<unknown>()
    sendMessage.mockReturnValue(response.promise)
    let pending!: Promise<boolean>
    await act(async () => {
      pending = download.startDownload(["two", "missing"])
      expect(await download.startDownload(["one"])).toBe(false)
    })
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))
    expect(download.isEnqueuing).toBe(true)
    expect(sendMessage.mock.calls[0][0].payload).toEqual({
      sourceWindowId: 0,
      sourceTabId: 0,
      sourceUrl: mangaState.sourceUrl,
      siteIntegrationId: "mangadex",
      seriesId: "series",
      seriesRevision: 3,
      selectedChapterIds: ["two"],
    })
    await act(async () => {
      response.resolve({ success: true, taskId: "accepted-task" })
      expect(await pending).toBe(true)
    })
    expect(download.isEnqueuing).toBe(false)
    expect(JSON.parse(container.textContent).notices).toEqual([
      t("sidepanel_addedToQueue"),
    ])
  })

  it("reports missing selections and logical failures, then permits another attempt", async () => {
    await act(async () =>
      expect(await download.startDownload(["missing"])).toBe(false)
    )
    expect(download.errorMessage).toBe(
      t("sidepanel_selectedChaptersUnavailable")
    )
    expect(sendMessage).not.toHaveBeenCalled()
    sendMessage
      .mockResolvedValueOnce({
        success: false,
        error: "stale",
        code: "stale_series_context",
      })
      .mockResolvedValue({ success: true, taskId: "accepted-task" })
    await act(async () =>
      expect(await download.startDownload(["one"])).toBe(false)
    )
    expect(download.errorMessage).toBe(
      t("startDownloadError_staleSeriesContext")
    )
    await act(async () =>
      expect(await download.startDownload(["one"])).toBe(true)
    )
    expect(download.errorMessage).toBeNull()
  })

  it("requires a current context before starting work", async () => {
    act(() => root.render(createElement(Harness, { revision: null })))
    await act(async () =>
      expect(await download.startDownload(["one"])).toBe(false)
    )
    expect(sendMessage).not.toHaveBeenCalled()
    expect(download.isEnqueuing).toBe(false)
  })

  it("reports an unavailable background transport and releases enqueue ownership for retry", async () => {
    sendMessage.mockRejectedValue(new Error("Background unavailable"))
    await act(async () =>
      expect(await download.startDownload(["one"])).toBe(false)
    )
    expect(download.isEnqueuing).toBe(false)
    expect(download.errorMessage).toBe(t("sidepanel_enqueueFailed"))
    sendMessage.mockResolvedValue({ success: true, taskId: "accepted-task" })
    await act(async () =>
      expect(await download.startDownload(["one"])).toBe(true)
    )
    expect(download.errorMessage).toBeNull()
  })

  it("settles accepted work after unmount without notifying a closed panel", async () => {
    const response = Promise.withResolvers<unknown>()
    sendMessage.mockReturnValue(response.promise)
    let pending!: Promise<boolean>
    await act(async () => {
      pending = download.startDownload(["one"])
    })
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))
    act(() => root.render(createElement(Harness, { show: false })))
    await act(async () => {
      response.resolve({ success: true, taskId: "accepted-task" })
      expect(await pending).toBe(true)
    })
    expect(JSON.parse(container.textContent).notices).toEqual([])
  })
})

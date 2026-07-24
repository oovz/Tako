import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  loggerDebug: vi.fn(),
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: mocks.loggerDebug,
  },
}))

vi.mock("@/src/site-integrations/url-matcher", () => ({
  matchUrl: vi.fn((url: string) =>
    url.includes("/title/")
      ? { integrationId: "mangadex", role: "series" }
      : null
  ),
}))

import { createTabUiCoordinator } from "@/entrypoints/background/tab-ui-coordinator"

describe("createTabUiCoordinator", () => {
  const actionEnable = vi.fn(async () => undefined)
  const actionSetTitle = vi.fn(async () => undefined)
  const actionSetIcon = vi.fn(async () => undefined)
  const actionSetBadgeText = vi.fn(async () => undefined)
  const actionSetBadgeBackgroundColor = vi.fn(async () => undefined)
  const sidePanelSetOptions = vi.fn(async () => undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("chrome", {
      action: {
        enable: actionEnable,
        setTitle: actionSetTitle,
        setIcon: actionSetIcon,
        setBadgeText: actionSetBadgeText,
        setBadgeBackgroundColor: actionSetBadgeBackgroundColor,
      },
      sidePanel: {
        setOptions: sidePanelSetOptions,
      },
    })
  })

  it("does not repurpose the action badge as a supported-site indicator", async () => {
    const coordinator = createTabUiCoordinator()

    await coordinator.updateActionForTab(
      7,
      "https://mangadex.org/title/series-1"
    )

    expect(actionEnable).toHaveBeenCalledWith(7)
    expect(actionSetTitle).toHaveBeenCalledWith({
      tabId: 7,
      title: "TMD: Supported site",
    })
    expect(actionSetIcon).toHaveBeenCalledWith({
      tabId: 7,
      path: {
        16: "icon/16.png",
        32: "icon/32.png",
        48: "icon/48.png",
        128: "icon/128.png",
      },
    })
    expect(actionSetBadgeText).not.toHaveBeenCalled()
    expect(actionSetBadgeBackgroundColor).not.toHaveBeenCalled()
  })

  it("does not clear the global queue badge on unsupported tabs", async () => {
    const coordinator = createTabUiCoordinator()

    await coordinator.updateActionForTab(8, "https://example.com/not-supported")

    expect(actionEnable).toHaveBeenCalledWith(8)
    expect(actionSetTitle).toHaveBeenCalledWith({
      tabId: 8,
      title: "TMD: Unsupported site",
    })
    expect(actionSetIcon).toHaveBeenCalledWith({
      tabId: 8,
      path: {
        16: "icon/inactive-16.png",
        32: "icon/inactive-32.png",
        48: "icon/inactive-48.png",
        128: "icon/inactive-128.png",
      },
    })
    expect(actionSetBadgeText).not.toHaveBeenCalled()
    expect(actionSetBadgeBackgroundColor).not.toHaveBeenCalled()
  })

  it("uses the active icon as a fallback when the inactive icon is unavailable", async () => {
    actionSetIcon.mockRejectedValueOnce(new Error("missing inactive assets"))
    const coordinator = createTabUiCoordinator()

    await coordinator.updateActionForTab(9, null)

    expect(actionSetIcon).toHaveBeenCalledTimes(2)
    expect(actionSetIcon).toHaveBeenLastCalledWith({
      tabId: 9,
      path: {
        16: "icon/16.png",
        32: "icon/32.png",
        48: "icon/48.png",
        128: "icon/128.png",
      },
    })
  })

  it("contains failures while setting either the active icon or outer action state", async () => {
    actionSetIcon.mockRejectedValueOnce(new Error("icon failure"))
    const coordinator = createTabUiCoordinator()

    await expect(
      coordinator.updateActionForTab(10, "https://mangadex.org/title/series-1")
    ).resolves.toBeUndefined()
    expect(actionSetIcon).toHaveBeenCalledTimes(1)

    actionEnable.mockRejectedValueOnce(new Error("removed tab"))
    await expect(
      coordinator.updateActionForTab(11, "https://example.com")
    ).resolves.toBeUndefined()
    expect(mocks.loggerDebug).toHaveBeenCalledWith(
      "updateActionForTab noop/error",
      expect.any(Error)
    )
  })

  it("enables the side panel and contains errors for tabs removed mid-update", async () => {
    const coordinator = createTabUiCoordinator()

    await coordinator.updateSidePanelForTab(12)
    expect(sidePanelSetOptions).toHaveBeenCalledWith({
      tabId: 12,
      path: "sidepanel.html",
      enabled: true,
    })

    sidePanelSetOptions.mockRejectedValueOnce(new Error("tab replaced"))
    await expect(coordinator.updateSidePanelForTab(13)).resolves.toBeUndefined()
    expect(mocks.loggerDebug).toHaveBeenCalledWith(
      "Failed to set side panel options (non-fatal):",
      expect.any(Error)
    )
  })
})

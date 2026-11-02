// Offscreen reads integration settings through background messages.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const setEnablementMapMock = vi.fn()

vi.mock("@/src/site-integrations/catalog", () => ({
  setEnablementMap: setEnablementMapMock,
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe("offscreen site integration enablement loader", () => {
  const runtimeSendMessage = vi.fn()
  const storageLocalGet = vi.fn()
  const storageLocalSet = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: runtimeSendMessage,
      },
      // These spies detect direct storage access from offscreen.
      storage: {
        local: {
          get: storageLocalGet,
          set: storageLocalSet,
        },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("loads user enablement through background messaging", async () => {
    runtimeSendMessage.mockResolvedValueOnce({
      success: true,
      enablement: { mangadex: false, "pixiv-comic": true },
    })

    const { initializeOffscreenSiteIntegrations } =
      await import("@/src/runtime/site-integration-offscreen-initialization")

    await initializeOffscreenSiteIntegrations()

    expect(runtimeSendMessage).toHaveBeenCalledTimes(1)
    expect(runtimeSendMessage).toHaveBeenCalledWith({
      target: "background",
      type: "GET_SITE_INTEGRATION_ENABLEMENT",
    })

    expect(storageLocalGet).not.toHaveBeenCalled()
    expect(storageLocalSet).not.toHaveBeenCalled()

    expect(setEnablementMapMock).toHaveBeenCalledWith({
      mangadex: false,
      "pixiv-comic": true,
    })
  })

  it("loads current enablement for each request", async () => {
    runtimeSendMessage
      .mockResolvedValueOnce({
        success: true,
        enablement: { mangadex: false },
      })
      .mockResolvedValueOnce({
        success: true,
        enablement: { mangadex: true },
      })

    const {
      initializeOffscreenSiteIntegrations,
      loadOffscreenSiteIntegrationEnablement,
    } = await import("@/src/runtime/site-integration-offscreen-initialization")

    await initializeOffscreenSiteIntegrations()
    await expect(loadOffscreenSiteIntegrationEnablement()).resolves.toEqual({
      mangadex: true,
    })
    expect(runtimeSendMessage).toHaveBeenCalledTimes(2)
  })

  it("fails closed when the background rejects the enablement read", async () => {
    runtimeSendMessage.mockResolvedValueOnce({
      success: false,
      error: "storage read failed",
    })

    const { initializeOffscreenSiteIntegrations } =
      await import("@/src/runtime/site-integration-offscreen-initialization")

    await expect(initializeOffscreenSiteIntegrations()).rejects.toThrow(
      "Failed to load site integration enablement: storage read failed"
    )

    expect(runtimeSendMessage).toHaveBeenCalledWith({
      target: "background",
      type: "GET_SITE_INTEGRATION_ENABLEMENT",
    })
    expect(setEnablementMapMock).not.toHaveBeenCalled()
    expect(storageLocalGet).not.toHaveBeenCalled()
  })

  it("allows initialization to retry after a transport failure", async () => {
    runtimeSendMessage.mockRejectedValueOnce(
      new Error("extension context invalidated")
    )
    runtimeSendMessage.mockResolvedValueOnce({
      success: true,
      enablement: { mangadex: false },
    })

    const { initializeOffscreenSiteIntegrations } =
      await import("@/src/runtime/site-integration-offscreen-initialization")

    await expect(initializeOffscreenSiteIntegrations()).rejects.toThrow(
      "extension context invalidated"
    )
    await expect(initializeOffscreenSiteIntegrations()).resolves.toBeUndefined()

    expect(runtimeSendMessage).toHaveBeenCalledTimes(2)
    expect(runtimeSendMessage).toHaveBeenLastCalledWith({
      target: "background",
      type: "GET_SITE_INTEGRATION_ENABLEMENT",
    })
    expect(setEnablementMapMock).toHaveBeenCalledWith({
      mangadex: false,
    })
    expect(storageLocalGet).not.toHaveBeenCalled()
  })
})

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createSeriesContextRecoveryCoordinator,
  resolveCurrentSidepanelWindowId,
} from "@/entrypoints/sidepanel/hooks/useSidepanelSeriesContext"
import type { ActiveTabContextValue } from "@/entrypoints/sidepanel/hooks/sidepanelSeriesContextHelpers"

function readyContext(
  chaptersLoading: boolean,
  lastUpdated = 1,
  revision: number | null = 1
): ActiveTabContextValue {
  return {
    kind: "ready",
    ...(revision === null ? {} : { revision }),
    mangaState: {
      sourceUrl: "https://mangadex.org/title/series-1",
      siteIntegrationId: "mangadex",
      mangaId: "series-1",
      seriesTitle: "Series 1",
      chapters: [],
      volumes: [],
      chaptersLoading,
      lastUpdated,
    },
  }
}

const observation = {
  hydrated: true,
  tabId: 7,
  windowId: 2,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("sidepanel window resolution", () => {
  it("falls back to the current tab when the current window omits its id", async () => {
    const getCurrentTab = vi.fn(async () => ({ windowId: 9 }))
    vi.stubGlobal("chrome", {
      windows: {
        getCurrent: vi.fn(async () => ({})),
      },
      tabs: {
        getCurrent: getCurrentTab,
      },
    })

    await expect(resolveCurrentSidepanelWindowId()).resolves.toBe(9)
    expect(getCurrentTab).toHaveBeenCalledTimes(1)
  })
})

describe("sidepanel series-context recovery coordinator", () => {
  it("coalesces explicit retry commands while the current request is pending", async () => {
    const response = Promise.withResolvers<{ success: true }>()
    const requestRefresh = vi.fn(() => response.promise)
    const coordinator = createSeriesContextRecoveryCoordinator({
      requestRefresh,
    })
    const failed = {
      ...observation,
      sourceUrl: "https://mangadex.org/title/series-1",
      activeTabContext: {
        kind: "error" as const,
        error: "Provider unavailable",
      },
    }
    const first = coordinator.retry(failed)
    const duplicate = coordinator.retry(failed)
    try {
      expect(requestRefresh).toHaveBeenCalledExactlyOnceWith({
        tabId: 7,
        windowId: 2,
        reason: "sidepanel-retry",
      })
    } finally {
      response.resolve({ success: true })
      await Promise.all([first, duplicate])
    }
    await coordinator.retry(failed)
    expect(requestRefresh).toHaveBeenCalledTimes(2)
  })

  it("waits for another explicit retry after an error passes through loading to a different error", async () => {
    const requestRefresh = vi.fn(async () => ({ success: true as const }))
    const coordinator = createSeriesContextRecoveryCoordinator({
      requestRefresh,
    })
    await coordinator.retry({
      ...observation,
      sourceUrl: "https://mangadex.org/title/series-1",
      activeTabContext: { kind: "error", error: "Provider unavailable" },
    })
    await coordinator.recoverIfNeeded({
      ...observation,
      sourceUrl: "https://mangadex.org/title/series-1",
      activeTabContext: { kind: "loading" },
    })
    const failedAgain = {
      ...observation,
      sourceUrl: "https://mangadex.org/title/series-1",
      activeTabContext: {
        kind: "error" as const,
        error: "Upstream access failed",
      },
    }
    await coordinator.recoverIfNeeded(failedAgain)
    expect(requestRefresh).toHaveBeenCalledTimes(1)
    await coordinator.retry(failedAgain)
    expect(requestRefresh).toHaveBeenCalledTimes(2)
    expect(requestRefresh).toHaveBeenLastCalledWith({
      tabId: 7,
      windowId: 2,
      reason: "sidepanel-retry",
    })
    await coordinator.recoverIfNeeded(failedAgain)
    expect(requestRefresh).toHaveBeenCalledTimes(2)
  })

  it("recovers cached ready state that has no authoritative revision", async () => {
    const requestRefresh = vi.fn(async () => ({ success: true as const }))
    const coordinator = createSeriesContextRecoveryCoordinator({
      requestRefresh,
    })

    await coordinator.recoverIfNeeded({
      ...observation,
      activeTabContext: readyContext(false, 1, null),
    })

    expect(requestRefresh).toHaveBeenCalledWith({
      tabId: 7,
      windowId: 2,
    })
  })

  it("starts a recovery when a complete context becomes partial on the same tab", async () => {
    const requestRefresh = vi.fn(async () => ({ success: true as const }))
    const coordinator = createSeriesContextRecoveryCoordinator({
      requestRefresh,
    })

    await coordinator.recoverIfNeeded({
      ...observation,
      activeTabContext: readyContext(false),
    })
    await coordinator.recoverIfNeeded({
      ...observation,
      activeTabContext: readyContext(true),
    })
    await coordinator.recoverIfNeeded({
      ...observation,
      activeTabContext: readyContext(true),
    })

    expect(requestRefresh).toHaveBeenCalledTimes(1)
    expect(requestRefresh).toHaveBeenCalledWith({
      tabId: 7,
      windowId: 2,
    })
  })

  it("starts a new recovery episode after a partial context becomes complete", async () => {
    const requestRefresh = vi.fn(async () => ({ success: true as const }))
    const coordinator = createSeriesContextRecoveryCoordinator({
      requestRefresh,
    })

    await coordinator.recoverIfNeeded({
      ...observation,
      activeTabContext: readyContext(true),
    })
    await coordinator.recoverIfNeeded({
      ...observation,
      activeTabContext: readyContext(false),
    })
    await coordinator.recoverIfNeeded({
      ...observation,
      activeTabContext: readyContext(true),
    })

    expect(requestRefresh).toHaveBeenCalledTimes(2)
  })

  it("recovers a newer partial projection after a successful request", async () => {
    const requestRefresh = vi.fn(async () => ({ success: true as const }))
    const coordinator = createSeriesContextRecoveryCoordinator({
      requestRefresh,
    })

    await coordinator.recoverIfNeeded({
      ...observation,
      activeTabContext: readyContext(true, 1),
    })
    await coordinator.recoverIfNeeded({
      ...observation,
      activeTabContext: readyContext(true, 2),
    })

    expect(requestRefresh).toHaveBeenCalledTimes(2)
  })

  it("unlocks the same recovery episode after transport rejection", async () => {
    const requestRefresh = vi
      .fn()
      .mockRejectedValueOnce(new Error("worker unavailable"))
      .mockResolvedValueOnce({ success: true as const })
    const coordinator = createSeriesContextRecoveryCoordinator({
      requestRefresh,
    })
    const partial = {
      ...observation,
      activeTabContext: readyContext(true),
    }

    await expect(coordinator.recoverIfNeeded(partial)).rejects.toThrow(
      "worker unavailable"
    )
    await expect(coordinator.recoverIfNeeded(partial)).resolves.toBeUndefined()

    expect(requestRefresh).toHaveBeenCalledTimes(2)
  })

  it("unlocks the same recovery episode after an unsuccessful response", async () => {
    const requestRefresh = vi
      .fn()
      .mockResolvedValueOnce({ success: false as const, error: "inactive tab" })
      .mockResolvedValueOnce({ success: true as const })
    const coordinator = createSeriesContextRecoveryCoordinator({
      requestRefresh,
    })
    const partial = {
      ...observation,
      activeTabContext: readyContext(true),
    }

    await coordinator.recoverIfNeeded(partial)
    await coordinator.recoverIfNeeded(partial)

    expect(requestRefresh).toHaveBeenCalledTimes(2)
  })
})

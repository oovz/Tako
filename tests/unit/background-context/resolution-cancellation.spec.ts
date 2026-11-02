import { expect, it, vi } from "vitest"
import { createTabContextResolver } from "@/entrypoints/background/tab-context-resolver"

it("does not claim a loading revision after its tab snapshot owner is canceled", async () => {
  const projectLoadingForTab = vi.fn(async () => ({ requestId: 1 }))
  const tab = {
    id: 7,
    windowId: 2,
    active: true,
    url: "https://mangadex.org/title/series",
  }
  let reads = 0
  vi.stubGlobal("chrome", {
    tabs: {
      get: () => {
        const snapshot = Promise.resolve(tab)
        reads += 1
        if (reads === 2)
          void snapshot.then(() =>
            queueMicrotask(() => resolver.cancelTabContextResolution(7))
          )
        return snapshot
      },
    },
  })
  const resolver = createTabContextResolver({
    tabContextCache: { projectLoadingForTab } as never,
    getTabContextStateService: () => {
      throw new Error("Canceled owner cannot mutate state")
    },
    rateLimitService: {} as never,
    siteIntegrationSettingsReader: {
      getAll: async () => ({}),
      getForSite: async () => ({}),
    },
  })
  await resolver.resolveTabContext(7, { windowId: 2 })
  expect(projectLoadingForTab).not.toHaveBeenCalled()
})

it("rejects a resolution whose requested window no longer owns the tab", async () => {
  const projectLoadingForTab = vi.fn(async () => ({ requestId: 1 }))
  vi.stubGlobal("chrome", {
    tabs: {
      get: async () => ({
        id: 7,
        windowId: 2,
        active: true,
        url: "https://mangadex.org/title/series",
      }),
    },
  })
  const resolver = createTabContextResolver({
    tabContextCache: { projectLoadingForTab } as never,
    getTabContextStateService: () => {
      throw new Error("A different window cannot mutate tab state")
    },
    rateLimitService: {} as never,
    siteIntegrationSettingsReader: {
      getAll: async () => ({}),
      getForSite: async () => ({}),
    },
  })
  await resolver.resolveTabContext(7, { windowId: 3 })
  expect(projectLoadingForTab).not.toHaveBeenCalled()
})

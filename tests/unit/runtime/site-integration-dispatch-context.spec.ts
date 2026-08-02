import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getBackgroundSiteAdapterById: vi.fn(),
  getSiteIntegrationManifestById: vi.fn(),
}))

vi.mock("@/src/runtime/background-site-integration-initialization", () => ({
  getBackgroundSiteAdapterById: mocks.getBackgroundSiteAdapterById,
}))

vi.mock("@/src/site-integrations/manifest", () => ({
  getSiteIntegrationManifestById: mocks.getSiteIntegrationManifestById,
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: vi.fn(),
  },
}))

import { resolveSiteIntegrationDispatchContext } from "@/src/runtime/site-integration-dispatch-context"

const input = {
  siteIntegrationId: "provider",
  taskId: "task-1",
  seriesKey: "provider:series-1",
  chapter: {
    id: "chapter-1",
    title: "Chapter 1",
    url: "https://provider.example/chapter/1",
    index: 0,
    comicInfo: {} as never,
  },
  settingsSnapshot: {} as never,
}

describe("site integration dispatch context", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("does not load an adapter when dispatch context is not declared", async () => {
    mocks.getSiteIntegrationManifestById.mockReturnValue({
      runtimes: { dispatchContext: "none" },
    })

    await expect(
      resolveSiteIntegrationDispatchContext(input)
    ).resolves.toBeUndefined()
    expect(mocks.getBackgroundSiteAdapterById).not.toHaveBeenCalled()
  })

  it("keeps an optional context failure nonfatal", async () => {
    mocks.getSiteIntegrationManifestById.mockReturnValue({
      runtimes: { dispatchContext: "optional" },
    })
    mocks.getBackgroundSiteAdapterById.mockRejectedValue(
      new Error("optional settings unavailable")
    )

    await expect(
      resolveSiteIntegrationDispatchContext(input)
    ).resolves.toBeUndefined()
  })

  it("propagates a required context failure", async () => {
    const failure = new Error("required token unavailable")
    mocks.getSiteIntegrationManifestById.mockReturnValue({
      runtimes: { dispatchContext: "required" },
    })
    mocks.getBackgroundSiteAdapterById.mockResolvedValue({
      background: {
        prepareDispatchContext: vi.fn().mockRejectedValue(failure),
      },
    })

    await expect(resolveSiteIntegrationDispatchContext(input)).rejects.toBe(
      failure
    )
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getBackgroundSiteAdapterById: vi.fn(),
  getDefinition: vi.fn(),
}))

vi.mock("@/src/runtime/background-site-integration-initialization", () => ({
  getBackgroundSiteAdapterById: mocks.getBackgroundSiteAdapterById,
}))

vi.mock("@/src/site-integrations/catalog", () => ({
  getDefinition: mocks.getDefinition,
}))

vi.mock("@/src/runtime/generated/site-integration-offscreen-registry", () => ({
  offscreenSiteAdaptersById: {
    provider: {
      offscreen: {
        dispatchContext: {
          parse: (value: JsonObject) => {
            if (
              typeof value !== "object" ||
              value === null ||
              typeof (value as { token?: unknown }).token !== "string"
            ) {
              throw new Error("Invalid provider dispatch context")
            }
            return { token: (value as { token: string }).token }
          },
        },
      },
    },
  },
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: vi.fn(),
  },
}))

import { resolveSiteIntegrationDispatchContext } from "@/src/runtime/site-integration-dispatch-context"
import { readSiteIntegrationDispatchContext } from "@/src/runtime/site-integration-dispatch-context-envelope"
import type { JsonObject } from "@/src/types/site-integrations"
import type { SiteIntegrationSettingsReader } from "@/src/types/site-integrations"

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
  siteIntegrationSettingsReader: {
    getAll: vi.fn(async () => ({})),
    getForSite: vi.fn(async () => ({})),
  } satisfies SiteIntegrationSettingsReader,
}

describe("site integration dispatch context", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("does not load an adapter when dispatch context is not declared", async () => {
    mocks.getDefinition.mockReturnValue({
      runtimes: { dispatchContext: { mode: "none" } },
    })

    await expect(
      resolveSiteIntegrationDispatchContext(input)
    ).resolves.toBeUndefined()
    expect(mocks.getBackgroundSiteAdapterById).not.toHaveBeenCalled()
  })

  it("keeps an optional context failure nonfatal", async () => {
    mocks.getDefinition.mockReturnValue({
      runtimes: { dispatchContext: { mode: "optional", schemaVersion: 1 } },
    })
    mocks.getBackgroundSiteAdapterById.mockRejectedValue(
      new Error("optional settings unavailable")
    )

    await expect(
      resolveSiteIntegrationDispatchContext(input)
    ).resolves.toBeUndefined()
  })

  it("transports provider-prepared data without a second background parse", async () => {
    mocks.getDefinition.mockReturnValue({
      runtimes: { dispatchContext: { mode: "optional", schemaVersion: 1 } },
    })
    mocks.getBackgroundSiteAdapterById.mockResolvedValue({
      background: {
        prepareDispatchContext: vi
          .fn()
          .mockResolvedValue({ token: "prepared" }),
      },
    })

    await expect(resolveSiteIntegrationDispatchContext(input)).resolves.toEqual(
      { schemaVersion: 1, data: { token: "prepared" } }
    )
  })

  it("propagates a required context failure", async () => {
    const failure = new Error("required token unavailable")
    mocks.getDefinition.mockReturnValue({
      runtimes: { dispatchContext: { mode: "required", schemaVersion: 1 } },
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

  it("wraps provider data in the declared current schema version", async () => {
    mocks.getDefinition.mockReturnValue({
      runtimes: { dispatchContext: { mode: "required", schemaVersion: 7 } },
    })
    mocks.getBackgroundSiteAdapterById.mockResolvedValue({
      background: {
        prepareDispatchContext: vi.fn().mockResolvedValue({ token: "ok" }),
      },
    })

    await expect(resolveSiteIntegrationDispatchContext(input)).resolves.toEqual(
      { schemaVersion: 7, data: { token: "ok" } }
    )
  })

  it("accepts only the exact current dispatch-context schema version", () => {
    mocks.getDefinition.mockReturnValue({
      runtimes: { dispatchContext: { mode: "optional", schemaVersion: 7 } },
    })

    expect(
      readSiteIntegrationDispatchContext("provider", {
        schemaVersion: 7,
        data: { token: "ok" },
      })
    ).toEqual({ token: "ok" })
    expect(() =>
      readSiteIntegrationDispatchContext("provider", {
        schemaVersion: 6,
        data: { token: "stale" },
      })
    ).toThrow("Unsupported dispatch context schema version 6")
  })

  it("rejects context supplied to a provider that declares none", () => {
    mocks.getDefinition.mockReturnValue({
      runtimes: { dispatchContext: { mode: "none" } },
    })

    expect(() =>
      readSiteIntegrationDispatchContext("provider", {
        schemaVersion: 1,
        data: {},
      })
    ).toThrow("Dispatch context is not supported")
  })

  it("rejects malformed current-version provider context", () => {
    mocks.getDefinition.mockReturnValue({
      runtimes: { dispatchContext: { mode: "optional", schemaVersion: 7 } },
    })

    expect(() =>
      readSiteIntegrationDispatchContext("provider", {
        schemaVersion: 7,
        data: { token: 42 },
      })
    ).toThrow("Invalid provider dispatch context")
  })
})

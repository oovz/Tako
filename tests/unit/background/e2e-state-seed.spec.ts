import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  E2E_SEED_TAB_CONTEXT_MESSAGE,
  registerE2EStateSeedListener,
} from "@/entrypoints/background/e2e-state-seed"
import type { TabContextStateService } from "@/entrypoints/background/tab-context-state-service"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { SiteIntegrationEnablementService } from "@/src/storage/site-integration-enablement-service"

describe("E2E tab-context seed ingress", () => {
  const addListener = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("chrome", {
      runtime: {
        id: "extension-id",
        onMessage: { addListener },
      },
    } as unknown as typeof chrome)
  })

  it.each([{ title: "Injected Title" }, { unsupported: true }])(
    "rejects non-snapshot metadata fields %#",
    (extraMetadata) => {
      registerE2EStateSeedListener({
        ensureRuntimeReady: vi.fn(async () => undefined),
        getTabContextStateService: vi.fn(() => ({}) as TabContextStateService),
        cancelTabContextResolution: vi.fn(),
        queueRepository: {} as unknown as QueueRepository,
        siteIntegrationEnablementService: {
          setAll: vi.fn(async () => undefined),
        } satisfies Pick<SiteIntegrationEnablementService, "setAll">,
      })
      const listener = addListener.mock.calls[0]?.[0] as (
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: unknown) => void
      ) => boolean
      const sendResponse = vi.fn()

      expect(
        listener(
          {
            target: "e2e",
            type: E2E_SEED_TAB_CONTEXT_MESSAGE,
            payload: {
              tabId: 7,
              context: {
                context: "ready",
                sourceUrl: "https://example.test/series/1",
                siteIntegrationId: "site",
                mangaId: "series-1",
                seriesTitle: "Authoritative Series",
                chapters: [],
                metadata: {
                  author: "Test Author",
                  ...extraMetadata,
                },
              },
            },
          },
          {
            id: "extension-id",
            url: "chrome-extension://extension-id/sidepanel.html",
            documentId: "sidepanel-document",
          },
          sendResponse
        )
      ).toBe(true)
      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: "Invalid E2E seed request",
      })
    }
  )

  it.each([
    [
      "wrong extension",
      {
        id: "another-extension",
        url: "chrome-extension://another-extension/sidepanel.html",
      },
    ],
    [
      "content sender",
      {
        id: "extension-id",
        url: "https://example.test/series/1",
        tab: { id: 7 },
      },
    ],
  ] as const)("rejects %s for a valid seed request", (_label, sender) => {
    registerE2EStateSeedListener({
      ensureRuntimeReady: vi.fn(async () => undefined),
      getTabContextStateService: vi.fn(() => ({}) as TabContextStateService),
      cancelTabContextResolution: vi.fn(),
      queueRepository: {} as unknown as QueueRepository,
      siteIntegrationEnablementService: {
        setAll: vi.fn(async () => undefined),
      } satisfies Pick<SiteIntegrationEnablementService, "setAll">,
    })
    const listener = addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void
    ) => boolean
    const sendResponse = vi.fn()

    expect(
      listener(
        {
          target: "e2e",
          type: E2E_SEED_TAB_CONTEXT_MESSAGE,
          payload: {
            tabId: 7,
            context: {
              context: "ready",
              sourceUrl: "https://example.test/series/1",
              siteIntegrationId: "site",
              mangaId: "series-1",
              seriesTitle: "Authoritative Series",
              chapters: [],
              metadata: { author: "Test Author" },
            },
          },
        },
        sender as chrome.runtime.MessageSender,
        sendResponse
      )
    ).toBe(true)
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: "Unauthorized E2E seed sender",
    })
  })

  it("cancels an in-flight resolver before applying an authoritative seed", async () => {
    const cancelTabContextResolution = vi.fn()
    const commitResolvedTabContext = vi.fn(async () => ({ success: true }))
    const ensureRuntimeReady = vi.fn(async () => undefined)
    vi.stubGlobal("chrome", {
      runtime: {
        id: "extension-id",
        onMessage: { addListener },
      },
      tabs: {
        get: vi.fn(async () => ({
          id: 7,
          active: true,
          windowId: 3,
          url: "https://example.test/series/1",
        })),
      },
    } as unknown as typeof chrome)

    registerE2EStateSeedListener({
      ensureRuntimeReady,
      getTabContextStateService: vi.fn(() => ({
        commitResolvedTabContext,
      })) as unknown as () => TabContextStateService,
      cancelTabContextResolution,
      queueRepository: {} as unknown as QueueRepository,
      siteIntegrationEnablementService: {
        setAll: vi.fn(async () => undefined),
      } satisfies Pick<SiteIntegrationEnablementService, "setAll">,
    })
    const listener = addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void
    ) => boolean
    const sendResponse = vi.fn()

    expect(
      listener(
        {
          target: "e2e",
          type: E2E_SEED_TAB_CONTEXT_MESSAGE,
          payload: {
            tabId: 7,
            context: {
              context: "ready",
              sourceUrl: "https://example.test/series/1",
              siteIntegrationId: "site",
              mangaId: "series-1",
              seriesTitle: "Authoritative Series",
              chapters: [],
              metadata: { author: "Test Author" },
            },
          },
        },
        {
          id: "extension-id",
          url: "chrome-extension://extension-id/sidepanel.html",
          documentId: "sidepanel-document",
        },
        sendResponse
      )
    ).toBe(true)

    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({ success: true })
    )
    expect(ensureRuntimeReady).toHaveBeenCalledOnce()
    expect(cancelTabContextResolution).toHaveBeenCalledTimes(2)
    expect(cancelTabContextResolution).toHaveBeenNthCalledWith(1, 7)
    expect(cancelTabContextResolution).toHaveBeenNthCalledWith(2, 7)
    expect(commitResolvedTabContext).toHaveBeenCalledOnce()
  })
})

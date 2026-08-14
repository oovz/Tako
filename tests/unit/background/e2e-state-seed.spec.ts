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
})

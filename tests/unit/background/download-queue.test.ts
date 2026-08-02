/**
 * Unit Tests: Download Queue Manager
 *
 * Tests task orchestration, queue processing with global single-active-task
 * semantics, same-tab/same-series queuing behavior, and state transitions.
 */

import { beforeEach, describe, vi } from "vitest"
import { registerDownloadQueueBehaviorCases } from "./download-queue-queue-behavior.cases"
import { registerDownloadQueueStartAndProcessCases } from "./download-queue-start-process.cases"
import { resetDownloadQueueTestEnvironment } from "./download-queue-test-setup"

// In Vitest 4, vi.mock must be in the test file itself to intercept imports
// pulled in via the setup module's re-exports.
vi.mock("@/entrypoints/background/queue-helpers", () => ({
  resolveDownloadPlan: vi.fn().mockResolvedValue({
    format: "cbz",
    overwriteExisting: false,
    book: {
      siteId: "test-site",
      seriesId: "series-1",
      seriesTitle: "Test Manga",
      comicInfoBase: { Series: "Test Manga" },
    },
    chapters: [
      {
        id: "ch1",
        url: "https://example.com/ch1",
        title: "Chapter 1",
        chapterNumber: 1,
        resolvedPath: "/downloads/Test Manga/Chapter 1.cbz",
      },
    ],
  }),
  validateDownloadPathForTask: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/src/runtime/logger", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}))
vi.mock("@/src/runtime/rate-limit", () => ({
  resolveEffectivePolicy: vi.fn(),
  scheduleForIntegrationScope: vi.fn(),
}))
vi.mock("@/src/runtime/site-integration-registry", () => ({
  findSiteIntegrationForUrl: vi.fn(() => ({
    id: "test-integration",
    name: "Test Integration",
    author: "tester",
  })),
  siteIntegrationRegistry: {
    findById: vi.fn(() => null),
  },
}))
vi.mock("@/src/runtime/background-site-integration-initialization", () => ({
  getBackgroundSiteAdapterById: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/src/site-integrations/session-rule-manager", () => {
  class ProviderNetworkPolicyPendingError extends Error {
    readonly siteIntegrationId: string

    constructor(siteIntegrationId: string) {
      super("Provider network policy is temporarily unavailable")
      this.siteIntegrationId = siteIntegrationId
    }
  }

  class ProviderNetworkPolicyActionRequiredError extends Error {
    readonly siteIntegrationId: string
    readonly reason: "integration_disabled" | "host_permission_denied"

    constructor(
      siteIntegrationId: string,
      reason: "integration_disabled" | "host_permission_denied"
    ) {
      super("Provider network policy requires user action")
      this.siteIntegrationId = siteIntegrationId
      this.reason = reason
    }
  }

  return {
    ensureSiteIntegrationNetworkReady: vi.fn(),
    ProviderNetworkPolicyPendingError,
    ProviderNetworkPolicyActionRequiredError,
  }
})
vi.mock("@/entrypoints/background/destination", () => ({
  destinationService: {
    getEffectiveDestination: vi.fn(async () => ({ kind: "downloads" })),
    preflight: vi.fn(async () => ({ ready: true })),
  },
  createDestinationIssue: vi.fn((context, kind) => ({
    id: `${context.taskId}:${context.chapterId ?? ""}:${kind}`,
    ...context,
    kind,
    occurredAt: 1,
  })),
  issueKindForPreflight: vi.fn((result) =>
    result.reason === "permission_prompt"
      ? "fsa_permission_required"
      : "fsa_folder_missing"
  ),
  notifyDestinationIssue: vi.fn(),
  clearDestinationIssuesForTask: vi.fn(),
  recordDestinationIssue: vi.fn(),
  recordDestinationRuntimeIssue: vi.fn(),
}))
vi.mock("@/src/storage/chapter-persistence-service", () => ({
  chapterPersistenceService: {
    markChapterAsDownloaded: vi.fn().mockResolvedValue(undefined),
  },
}))

describe("Download Queue Manager", () => {
  beforeEach(async () => {
    await resetDownloadQueueTestEnvironment()
  })

  registerDownloadQueueStartAndProcessCases()
  registerDownloadQueueBehaviorCases()
})

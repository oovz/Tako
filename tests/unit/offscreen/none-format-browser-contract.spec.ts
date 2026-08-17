import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { offscreenSiteAdaptersById, getDefinitionMock } = vi.hoisted(() => ({
  offscreenSiteAdaptersById: {} as Record<string, unknown>,
  getDefinitionMock: vi.fn(),
}))
import { createOffscreenDispatchFingerprint } from "@/src/runtime/offscreen-job-fingerprint"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { OffscreenIntegration } from "@/src/types/site-integrations"
import { writeBlobToPath } from "@/src/storage/fs-access"

vi.mock("@/src/runtime/generated/site-integration-offscreen-registry", () => ({
  offscreenSiteAdaptersById,
}))

vi.mock("@/src/site-integrations/catalog", () => ({
  getDefinition: getDefinitionMock,
  setEnablementMap: vi.fn(),
  isEnabled: (id: string, enablement: Record<string, boolean>) =>
    enablement[id] === true,
}))

vi.mock("@/src/runtime/rate-limit", () => ({
  RateLimitService: class {
    constructor(private readonly policySource: any) {}

    resolveEffectivePolicy(integrationId: string, scope: string) {
      return this.policySource.resolveEffectivePolicy(integrationId, scope)
    }

    scheduleForIntegrationScope(
      _integrationId: string,
      _scope: string,
      task: () => Promise<unknown>
    ) {
      return task()
    }

    cleanupRateLimiters() {}
  },
}))

vi.mock("@/src/shared/filename-sanitizer", () => ({
  sanitizeFilename: (value: string) => value,
  normalizeImageFilename: () => "normalized.jpg",
  getExtensionFromMimeType: (mimeType: string) =>
    mimeType === "image/png" ? "png" : "jpg",
}))

vi.mock("@/entrypoints/offscreen/image-processor", () => ({
  PromiseQueue: class {
    add(fn: () => Promise<unknown>) {
      return fn()
    }
    getQueueLength() {
      return 0
    }
    clear() {
      // no-op
    }
  },
  withRetries: async (fn: () => Promise<unknown>) => fn(),
  withTimeout: async (fn: () => Promise<unknown>) => fn(),
  getHttpStatusFromError: () => 500,
}))

vi.mock("@/src/storage/fs-access", () => ({
  loadDownloadRootHandle: vi.fn(),
  verifyPermission: vi.fn(),
  writeBlobToPath: vi.fn(),
}))

const messages: unknown[] = []

global.chrome = {
  runtime: {
    sendMessage: vi.fn(async (message: { type?: string }) => {
      messages.push(message)
      if (message.type === "GET_SITE_INTEGRATION_ENABLEMENT") {
        return { success: true, enablement: { "test-site": true } }
      }
      if (message.type === "OFFSCREEN_OUTPUT_READY") {
        return {
          success: true,
          disposition: "tracked",
          phase: "prepared",
        }
      }
      if (
        message.type === "OFFSCREEN_JOB_ACCEPTED" ||
        message.type === "OFFSCREEN_DOWNLOAD_PROGRESS" ||
        message.type === "OFFSCREEN_JOB_HEARTBEAT" ||
        message.type === "OFFSCREEN_JOB_TERMINAL"
      ) {
        return { success: true, disposition: "renewed" }
      }
      return { success: true }
    }),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
} as unknown as typeof chrome

const mockElement = {
  textContent: "",
  dataset: {},
  hidden: false,
  innerHTML: "",
}

global.document = {
  getElementById: vi.fn().mockReturnValue(mockElement),
  addEventListener: vi.fn(),
} as unknown as Document
global.window = global as unknown as Window & typeof globalThis
global.HTMLElement = class {} as unknown as typeof HTMLElement
global.HTMLDivElement = class {} as unknown as typeof HTMLDivElement

describe("NONE format + browser downloads contract (behavior-based)", () => {
  let worker: InstanceType<
    typeof import("@/entrypoints/offscreen/main").OffscreenWorker
  >
  let mockDownloadImage: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    messages.length = 0
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)

    const module = await import("@/entrypoints/offscreen/main")
    worker = new module.OffscreenWorker()

    mockDownloadImage = vi.fn().mockImplementation(async (url: string) => ({
      filename: url.endsWith("cover.jpg")
        ? "cover.jpg"
        : url.endsWith("2.jpg")
          ? "img2.jpg"
          : "img1.jpg",
      data: new ArrayBuffer(10),
      mimeType: "image/jpeg",
    }))

    const mockOffscreenIntegration = {
      id: "test-site",
      scope: "test",
      dispatchContext: {
        parse: (value: unknown) => value as Record<string, unknown>,
      },
      chapter: {
        resolveChapterPlan: async () => ({
          imageUrls: [
            "https://example.test/img1.jpg",
            "https://example.test/img2.jpg",
          ],
        }),
        downloadImage: mockDownloadImage,
      },
    } as unknown as OffscreenIntegration

    offscreenSiteAdaptersById["test-site"] = {
      id: "test-site",
      offscreen: mockOffscreenIntegration,
    }
    getDefinitionMock.mockReturnValue({
      imageTransform: { kind: "none", estimatedCostMs: 0 },
      retryOwner: "platform",
      runtimes: {
        dispatchContext: { mode: "optional", schemaVersion: 1 },
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("streams image files through OFFSCREEN_OUTPUT_READY in browser mode", async () => {
    const dispatch = {
      jobId: "job-none-browser",
      attempt: 1,
      taskId: "task-none-browser",
      seriesKey: "test-site:series-1",
      book: {
        siteIntegrationId: "test-site",
        seriesTitle: "Test Book",
        coverUrl: "https://example.com/cover.jpg",
      },
      chapter: {
        id: "c1",
        title: "Chapter 1",
        url: "http://example.com/c1",
        index: 1,
        chapterNumber: 1,
        resolvedPath: "Chapter 1",
      },
      settingsSnapshot: {
        ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "test-site"),
        archiveFormat: "none",
      },
      saveMode: "downloads-api",
      integrationContext: {
        schemaVersion: 1,
        data: { taskId: "task-123" },
      },
    } satisfies Omit<
      RuntimeMessageRequest<"OFFSCREEN_DOWNLOAD_CHAPTER">["payload"],
      "fingerprint"
    >
    const fingerprint = await createOffscreenDispatchFingerprint(dispatch)
    const acknowledgment = await worker.processDownloadChapter({
      ...dispatch,
      fingerprint,
    })

    expect(acknowledgment).toEqual({
      accepted: true,
      jobId: dispatch.jobId,
      attempt: dispatch.attempt,
      taskId: dispatch.taskId,
      chapterId: dispatch.chapter.id,
      fingerprint,
      documentInstanceId: worker.documentInstanceId,
    })
    await vi.waitFor(() =>
      expect(
        worker.getJobState({
          jobId: dispatch.jobId,
          attempt: dispatch.attempt,
          taskId: dispatch.taskId,
          chapterId: dispatch.chapter.id,
          fingerprint,
          documentInstanceId: worker.documentInstanceId,
        })
      ).toMatchObject({
        status: "terminal",
        outcome: { status: "completed" },
      })
    )

    const apiRequests = messages.filter(
      (message): message is { type: string; payload?: { filename?: string } } =>
        typeof message === "object" &&
        message !== null &&
        (message as { type?: string }).type === "OFFSCREEN_OUTPUT_READY"
    )

    expect(apiRequests.length).toBeGreaterThanOrEqual(3)
    expect(
      apiRequests.some((request) =>
        request.payload?.filename?.endsWith("000-cover.jpg")
      )
    ).toBe(true)
    expect(
      apiRequests.some((request) =>
        request.payload?.filename?.endsWith("ComicInfo.xml")
      )
    ).toBe(true)
    expect(writeBlobToPath).not.toHaveBeenCalled()
  })
})

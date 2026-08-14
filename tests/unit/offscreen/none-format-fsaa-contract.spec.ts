import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { offscreenSiteAdaptersById, getDefinitionMock } = vi.hoisted(() => ({
  offscreenSiteAdaptersById: {} as Record<string, unknown>,
  getDefinitionMock: vi.fn(),
}))

import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { createOffscreenDispatchFingerprint } from "@/src/runtime/offscreen-job-fingerprint"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"
import type { OffscreenIntegration } from "@/src/types/site-integrations"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import {
  loadDownloadRootHandle,
  queryFsaPermission,
  writeBlobToPath,
} from "@/src/storage/fs-access"

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
  queryFsaPermission: vi.fn(),
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

describe("NONE format + FSAA custom folder contract (behavior-based)", () => {
  let worker: InstanceType<
    typeof import("@/entrypoints/offscreen/main").OffscreenWorker
  >

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(writeBlobToPath).mockResolvedValue({ status: "written" })
    messages.length = 0
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)

    const module = await import("@/entrypoints/offscreen/main")
    worker = new module.OffscreenWorker()

    const mockDownloadImage = vi
      .fn()
      .mockImplementation(async (url: string) => ({
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
      resolution: { imageTransform: { kind: "none", estimatedCostMs: 0 } },
      retryOwner: "platform",
      runtimes: {
        dispatchContext: { mode: "optional", schemaVersion: 1 },
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("writes images and ComicInfo.xml through FS Access when custom folder permission is granted", async () => {
    vi.mocked(loadDownloadRootHandle).mockResolvedValue(
      {} as FileSystemDirectoryHandle
    )
    vi.mocked(queryFsaPermission).mockResolvedValue("granted")

    const dispatch = {
      jobId: "job-none-custom",
      attempt: 1,
      taskId: "task-none-custom",
      seriesKey: "test-site:series-1",
      book: {
        siteIntegrationId: "test-site",
        seriesTitle: "Test Book",
        coverUrl: "https://example.com/cover.jpg",
        metadata: {
          author: "Test Author",
          description: "A rich summary",
          genres: ["Action", "Drama"],
          communityRating: 4.5,
          language: "en",
          publisher: "Test Publisher",
        },
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
        conflictPolicy: "uniquify",
      },
      saveMode: "fsa",
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

    expect(acknowledgment).toMatchObject({
      accepted: true,
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
    expect(loadDownloadRootHandle).toHaveBeenCalledTimes(1)
    expect(queryFsaPermission).toHaveBeenCalledWith(expect.anything(), true)
    expect(writeBlobToPath).toHaveBeenCalled()
    expect(
      vi
        .mocked(writeBlobToPath)
        .mock.calls.every((call) => call[3] === "uniquify")
    ).toBe(true)
    expect(
      vi
        .mocked(writeBlobToPath)
        .mock.calls.some((call) => String(call[1]).endsWith("/ComicInfo.xml"))
    ).toBe(true)
    expect(
      vi
        .mocked(writeBlobToPath)
        .mock.calls.some((call) => String(call[1]).endsWith("/000-cover.jpg"))
    ).toBe(true)
    expect(
      messages.some(
        (message) =>
          (message as { type?: string }).type === "OFFSCREEN_OUTPUT_READY"
      )
    ).toBe(false)

    const comicInfoCall = vi
      .mocked(writeBlobToPath)
      .mock.calls.find((call) => String(call[1]).endsWith("/ComicInfo.xml"))
    expect(comicInfoCall).toBeDefined()

    const comicInfoBlob = comicInfoCall?.[2]
    expect(comicInfoBlob).toBeInstanceOf(Blob)

    const comicInfoText = await comicInfoBlob!.text()
    expect(comicInfoText).toContain("<Writer>Test Author</Writer>")
    expect(comicInfoText).toContain("<Summary>A rich summary</Summary>")
    expect(comicInfoText).toContain("<Genre>Action, Drama</Genre>")
    expect(comicInfoText).toContain("<CommunityRating>4.5</CommunityRating>")
    expect(comicInfoText).toContain("<LanguageISO>en</LanguageISO>")
    expect(comicInfoText).toContain("<Publisher>Test Publisher</Publisher>")
    expect(comicInfoText).toContain("<Format>Web</Format>")
  })

  it("blocks the chapter when custom folder permission is missing", async () => {
    vi.mocked(loadDownloadRootHandle).mockResolvedValue(
      {} as FileSystemDirectoryHandle
    )
    vi.mocked(queryFsaPermission).mockResolvedValue("prompt")

    const dispatch = {
      jobId: "job-none-custom-permission-lost",
      attempt: 1,
      taskId: "task-none-custom-permission-lost",
      seriesKey: "test-site:series-1",
      book: {
        siteIntegrationId: "test-site",
        seriesTitle: "Test Book",
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
      saveMode: "fsa",
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

    expect(acknowledgment).toMatchObject({ accepted: true, fingerprint })
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
        outcome: { status: "failed" },
      })
    )
    expect(
      messages.some(
        (message) =>
          (message as { type?: string }).type === "OFFSCREEN_OUTPUT_READY"
      )
    ).toBe(false)
  })
})

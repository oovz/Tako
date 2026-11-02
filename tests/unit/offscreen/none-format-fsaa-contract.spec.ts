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
    clear() {}
    cancelPending() {}
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

const mockResolveChapterPlan = vi.fn(async () => ({
  imageUrls: ["https://example.test/img1.jpg", "https://example.test/img2.jpg"],
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

describe("loose image saves to a custom folder", () => {
  let worker: InstanceType<
    typeof import("@/entrypoints/offscreen/main-worker").OffscreenWorker
  >

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(writeBlobToPath).mockResolvedValue({ status: "written" })
    messages.length = 0
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)

    const module = await import("@/entrypoints/offscreen/main-worker")
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
        resolveChapterPlan: mockResolveChapterPlan,
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

  it.each([
    "permit",
    "lost acknowledgement",
    "cancel",
    "background rejection",
  ] as const)(
    "coalesces consenting parallel writers and handles %s before writing",
    async (result) => {
      vi.mocked(loadDownloadRootHandle).mockResolvedValue({
        name: "Captured",
      } as FileSystemDirectoryHandle)
      vi.mocked(queryFsaPermission).mockResolvedValue("granted")
      const dispatch = {
        jobId: "consenting-job",
        attempt: 1,
        taskId: "consenting-task",
        seriesKey: "test-site:series",
        book: { siteIntegrationId: "test-site", seriesTitle: "Book" },
        chapter: {
          id: "chapter",
          title: "Chapter",
          url: "https://example.test/chapter",
          index: 1,
          resolvedPath: "Book/Chapter",
        },
        settingsSnapshot: {
          ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "test-site"),
          destination: {
            kind: "file-system-access" as const,
            handleId: "selected",
          },
          allowChromeFallback: true as const,
          archiveFormat: "none" as const,
          includeCoverImage: false,
          includeComicInfo: true,
        },
        saveMode: "fsa" as const,
        directoryHandleId: "selected",
      }
      const payload = {
        ...dispatch,
        fingerprint: await createOffscreenDispatchFingerprint(dispatch),
      }
      let release!: (value: unknown) => void
      let reject!: (reason: Error) => void
      const receipt = new Promise((resolve, fail) => {
        release = resolve
        reject = fail
      })
      const send = vi.mocked(chrome.runtime.sendMessage)
      const original = send.getMockImplementation()!
      send.mockImplementation(((...args: unknown[]) => {
        const message = args[0] as { type: string }
        if (message.type === "OFFSCREEN_BEGIN_FSA_WRITE") return receipt
        return Reflect.apply(original, chrome.runtime, args)
      }) as typeof original)
      try {
        await worker.processDownloadChapter(payload)
        await vi.waitFor(() =>
          expect(
            send.mock.calls.filter(
              (call) =>
                (call[0] as unknown as { type?: string })?.type ===
                "OFFSCREEN_BEGIN_FSA_WRITE"
            )
          ).toHaveLength(1)
        )
        expect(writeBlobToPath).not.toHaveBeenCalled()
        const identity = {
          jobId: payload.jobId,
          attempt: payload.attempt,
          taskId: payload.taskId,
          chapterId: payload.chapter.id,
          fingerprint: payload.fingerprint,
          documentInstanceId: worker.documentInstanceId,
        }
        if (result === "cancel") worker.cancelJob(identity)
        if (result === "lost acknowledgement")
          reject(new Error("response lost"))
        else if (result === "background rejection")
          release({
            success: false,
            error: "Receipt storage write was rejected",
          })
        else release({ success: true, permitted: true })
        await vi.waitFor(() =>
          expect(worker.getJobState(identity)?.status).toBe(
            result === "cancel" ? "canceled" : "terminal"
          )
        )
        if (result === "background rejection") {
          expect(worker.getJobState(identity)?.outcome).toMatchObject({
            status: "failed",
            errorCategory: "folder_write_failed",
            errorMessage: "Receipt storage write was rejected",
            outputsCommitted: 0,
          })
          expect(worker.getJobState(identity)?.outcome).not.toHaveProperty(
            "destinationUnavailable"
          )
          await vi.waitFor(() =>
            expect(send).toHaveBeenCalledWith(
              expect.objectContaining({
                type: "OFFSCREEN_JOB_TERMINAL",
                payload: expect.objectContaining({
                  outcome: expect.objectContaining({
                    errorCategory: "folder_write_failed",
                    errorMessage: "Receipt storage write was rejected",
                  }),
                }),
              })
            )
          )
        }
        if (result === "permit")
          expect(writeBlobToPath).toHaveBeenCalledTimes(3)
        else expect(writeBlobToPath).not.toHaveBeenCalled()
        expect(
          send.mock.calls.filter(
            (call) =>
              (call[0] as unknown as { type?: string })?.type ===
              "OFFSCREEN_BEGIN_FSA_WRITE"
          )
        ).toHaveLength(1)
      } finally {
        release({ success: true, permitted: false })
        send.mockImplementation(original)
      }
    }
  )

  it("marks a lost captured folder as a destination-resolution failure before provider work", async () => {
    vi.mocked(loadDownloadRootHandle).mockResolvedValue(undefined)
    const dispatch = {
      jobId: "lost-folder-job",
      attempt: 1,
      taskId: "lost-folder-task",
      seriesKey: "test-site:series",
      book: { siteIntegrationId: "test-site", seriesTitle: "Book" },
      chapter: {
        id: "chapter",
        title: "Chapter",
        url: "https://example.test/chapter",
        index: 1,
        resolvedPath: "Book/Chapter",
      },
      settingsSnapshot: {
        ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "test-site"),
        destination: {
          kind: "file-system-access" as const,
          handleId: "selected",
        },
        allowChromeFallback: true as const,
        archiveFormat: "none" as const,
      },
      saveMode: "fsa" as const,
      directoryHandleId: "selected",
    }
    const payload = {
      ...dispatch,
      fingerprint: await createOffscreenDispatchFingerprint(dispatch),
    }
    await worker.processDownloadChapter(payload)
    await vi.waitFor(() =>
      expect(
        worker.getJobState({
          jobId: payload.jobId,
          attempt: payload.attempt,
          taskId: payload.taskId,
          chapterId: payload.chapter.id,
          fingerprint: payload.fingerprint,
          documentInstanceId: worker.documentInstanceId,
        })
      ).toMatchObject({
        status: "terminal",
        outcome: {
          destinationUnavailable: true,
          status: "failed",
          outputsRequested: 0,
          outputsCommitted: 0,
        },
      })
    )
    expect(mockResolveChapterPlan).not.toHaveBeenCalled()
    expect(writeBlobToPath).not.toHaveBeenCalled()
    expect(
      vi
        .mocked(chrome.runtime.sendMessage)
        .mock.calls.some(
          (call) =>
            (call[0] as unknown as { type?: string })?.type ===
            "OFFSCREEN_BEGIN_FSA_WRITE"
        )
    ).toBe(false)
  })

  it("captures the folder before acknowledging duplicate dispatches and retains it during chapter resolution", async () => {
    const handle = { name: "Dispatched folder" } as FileSystemDirectoryHandle
    let supplyHandle!: (handle: FileSystemDirectoryHandle) => void
    const pendingHandle = new Promise<FileSystemDirectoryHandle>((resolve) => {
      supplyHandle = resolve
    })
    vi.mocked(loadDownloadRootHandle).mockReturnValueOnce(pendingHandle)
    vi.mocked(queryFsaPermission).mockResolvedValue("granted")
    let supplyPlan!: (plan: { imageUrls: string[] }) => void
    const pendingPlan = new Promise<{ imageUrls: string[] }>((resolve) => {
      supplyPlan = resolve
    })
    const resolveChapterPlan = vi.fn(() => pendingPlan)
    const integration = offscreenSiteAdaptersById["test-site"] as {
      offscreen: OffscreenIntegration
    }
    integration.offscreen.chapter.resolveChapterPlan = resolveChapterPlan
    const dispatch = {
      jobId: "captured-folder-job",
      attempt: 1,
      taskId: "captured-folder-task",
      seriesKey: "test-site:series-1",
      book: { siteIntegrationId: "test-site", seriesTitle: "Test Book" },
      chapter: {
        id: "c1",
        title: "Chapter 1",
        url: "https://example.test/c1",
        index: 1,
        resolvedPath: "Chapter 1",
      },
      settingsSnapshot: {
        ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "test-site"),
        archiveFormat: "none",
        includeCoverImage: false,
        includeComicInfo: false,
      },
      saveMode: "fsa",
      directoryHandleId: "selected-id",
    } satisfies Omit<
      RuntimeMessageRequest<"OFFSCREEN_DOWNLOAD_CHAPTER">["payload"],
      "fingerprint"
    >
    const payload = {
      ...dispatch,
      fingerprint: await createOffscreenDispatchFingerprint(dispatch),
    }
    let acknowledged = false
    const first = worker.processDownloadChapter(payload).then((ack) => {
      acknowledged = true
      return ack
    })
    await vi.waitFor(() =>
      expect(loadDownloadRootHandle).toHaveBeenCalledOnce()
    )
    let duplicateAcknowledged = false
    const duplicate = worker.processDownloadChapter(payload).then((ack) => {
      duplicateAcknowledged = true
      return ack
    })
    try {
      await vi.waitFor(() => expect(worker.getActiveJobCount()).toBe(1))
      expect(acknowledged).toBe(false)
      expect(duplicateAcknowledged).toBe(false)
      expect(resolveChapterPlan).not.toHaveBeenCalled()
      supplyHandle(handle)
      expect(await duplicate).toEqual(await first)
      await vi.waitFor(() => expect(resolveChapterPlan).toHaveBeenCalledOnce())
      vi.mocked(loadDownloadRootHandle).mockResolvedValue(undefined)
      supplyPlan({ imageUrls: ["https://example.test/img1.jpg"] })
      await vi.waitFor(() =>
        expect(
          worker.getJobState({
            jobId: dispatch.jobId,
            attempt: dispatch.attempt,
            taskId: dispatch.taskId,
            chapterId: dispatch.chapter.id,
            fingerprint: payload.fingerprint,
            documentInstanceId: worker.documentInstanceId,
          })
        ).toMatchObject({
          status: "terminal",
          outcome: { status: "completed" },
        })
      )
      expect(loadDownloadRootHandle).toHaveBeenCalledOnce()
      expect(writeBlobToPath).toHaveBeenCalledOnce()
      expect(vi.mocked(writeBlobToPath).mock.calls[0][0]).toBe(handle)
    } finally {
      supplyHandle(handle)
      supplyPlan({ imageUrls: [] })
    }
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
      directoryHandleId: "selected-id",
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
    expect(loadDownloadRootHandle).toHaveBeenCalledExactlyOnceWith(
      "selected-id"
    )
    expect(queryFsaPermission).not.toHaveBeenCalled()
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

  it.each(["write", "capture"] as const)(
    "reports native folder %s failure without a Chrome fallback",
    async (boundary) => {
      vi.mocked(loadDownloadRootHandle).mockResolvedValue(
        {} as FileSystemDirectoryHandle
      )
      const original = new DOMException(
        "Native folder access failed",
        "NotAllowedError"
      )
      mockResolveChapterPlan.mockClear()
      if (boundary === "capture")
        vi.mocked(loadDownloadRootHandle).mockRejectedValue(original)
      else vi.mocked(writeBlobToPath).mockRejectedValue(original)

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
        directoryHandleId: "selected-id",
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
          outcome: {
            status: "failed",
            errorMessage: original.message,
            errorCategory:
              boundary === "capture"
                ? "folder_unavailable"
                : "folder_permission_required",
          },
        })
      )
      expect(mockResolveChapterPlan).toHaveBeenCalledTimes(
        boundary === "capture" ? 0 : 1
      )
      expect(
        messages.some(
          (message) =>
            (message as { type?: string }).type === "OFFSCREEN_OUTPUT_READY"
        )
      ).toBe(false)
    }
  )
})
